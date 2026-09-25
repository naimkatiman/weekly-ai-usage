param([Parameter(Mandatory = $true)][string]$InstallerPath)

$ErrorActionPreference = 'Stop'
$taskInstaller = (Resolve-Path -LiteralPath $InstallerPath).Path
$taskUninstallKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\{BCD80182-BC56-4F3D-9608-14E0F73C8493}_is1'
$taskShortcutFolder = Join-Path ([Environment]::GetFolderPath('Programs')) 'Weekly AI Usage'
$taskShortcut = Join-Path $taskShortcutFolder 'Weekly AI Usage.lnk'
if ((Test-Path -LiteralPath $taskUninstallKey) -or (Test-Path -LiteralPath $taskShortcutFolder)) {
    throw 'An existing Weekly AI Usage installation or shortcut is present. Installer QA will not replace it.'
}
$taskRoot = Join-Path ([IO.Path]::GetTempPath()) ('WeeklyUsage-installer-tests-' + [guid]::NewGuid().ToString('N'))
$taskInstallDirectory = Join-Path $taskRoot 'app'
New-Item -ItemType Directory -Path $taskRoot | Out-Null
$taskRoot = (Resolve-Path -LiteralPath $taskRoot).Path
if ((Get-Item -LiteralPath $taskRoot).Attributes -band [IO.FileAttributes]::ReparsePoint) {
    throw 'Installer test root must not be a reparse point.'
}
if (-not [IO.Path]::GetFullPath($taskInstallDirectory).StartsWith($taskRoot + '\', [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Installer test target escaped its isolated root.'
}
$taskUserPath = [Environment]::GetEnvironmentVariable('PATH', 'User')
$taskMachinePath = [Environment]::GetEnvironmentVariable('PATH', 'Machine')
$taskUninstaller = Join-Path $taskInstallDirectory 'unins000.exe'
$taskInstalled = $false
$taskChecks = 0

function Assert-Installer([bool]$Condition, [string]$Message) {
    if (-not $Condition) { throw "Installer QA failed: $Message" }
    $script:taskChecks++
}
function Invoke-TestProgram([string]$File, [string[]]$Arguments) {
    $taskProcess = Start-Process -FilePath $File -ArgumentList $Arguments -PassThru -WindowStyle Hidden
    if (-not $taskProcess.WaitForExit(60000)) {
        $taskProcess.Kill()
        throw "Installer QA process timed out: $File"
    }
    $taskProcess.Refresh()
    if ($taskProcess.ExitCode -ne 0) { throw "Installer QA process exited $($taskProcess.ExitCode): $File" }
}
function Remove-TestInstallation {
    if (Test-Path -LiteralPath $taskUninstallKey) {
        $taskRegistered = Get-ItemProperty -LiteralPath $taskUninstallKey
        if ($taskRegistered.InstallLocation.TrimEnd('\') -ne $taskInstallDirectory.TrimEnd('\')) {
            throw 'Refusing to uninstall: the registry entry points outside the isolated test directory.'
        }
    }
    if (Test-Path -LiteralPath $taskUninstaller) {
        Invoke-TestProgram $taskUninstaller @('/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', ('/LOG="' + (Join-Path $taskRoot 'uninstall.log') + '"'))
        $taskDeadline = [DateTime]::UtcNow.AddSeconds(15)
        while (((Test-Path -LiteralPath $taskUninstallKey) -or (Test-Path -LiteralPath $taskUninstaller)) -and [DateTime]::UtcNow -lt $taskDeadline) { Start-Sleep -Milliseconds 100 }
    }
}

try {
    $taskArguments = @('/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/SP-', ('/DIR="' + $taskInstallDirectory + '"'))
    $taskInstalled = $true
    Invoke-TestProgram $taskInstaller ($taskArguments + ('/LOG="' + (Join-Path $taskRoot 'install.log') + '"'))
    $taskRegistered = Get-ItemProperty -LiteralPath $taskUninstallKey
    Assert-Installer ($taskRegistered.InstallLocation.TrimEnd('\') -eq $taskInstallDirectory.TrimEnd('\')) 'per-user uninstall entry points to test installation'
    Assert-Installer (Test-Path -LiteralPath $taskShortcut) 'Start Menu shortcut exists'
    $taskShell = New-Object -ComObject WScript.Shell
    $taskLink = $taskShell.CreateShortcut($taskShortcut)
    Assert-Installer ($taskLink.TargetPath -eq (Join-Path $taskInstallDirectory 'WeeklyUsage.exe')) 'shortcut opens the installed executable'
    Assert-Installer ($taskLink.WorkingDirectory -eq $taskInstallDirectory) 'shortcut starts in its installation directory'
    [Runtime.InteropServices.Marshal]::FinalReleaseComObject($taskLink) | Out-Null
    [Runtime.InteropServices.Marshal]::FinalReleaseComObject($taskShell) | Out-Null
    Assert-Installer (-not (Test-Path -LiteralPath (Join-Path $taskInstallDirectory 'accounts.json'))) 'installer ships no account roster'
    Assert-Installer (-not (Test-Path -LiteralPath (Join-Path $taskInstallDirectory 'usage-cache.json'))) 'installer ships no private cache'
    $taskNode = Join-Path $taskInstallDirectory 'runtime\node.exe'
    $taskNodeVersion = & $taskNode --version
    Assert-Installer ($LASTEXITCODE -eq 0 -and $taskNodeVersion -eq 'v24.21.0') 'bundled runtime starts at the pinned version'
    Assert-Installer (Test-Path -LiteralPath (Join-Path $taskInstallDirectory 'runtime\LICENSE')) 'Node license is included'

    # Compile the smoke driver against the actual installed application assembly.
    $taskCompiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
    $taskSmoke = Join-Path $taskInstallDirectory 'InstallerNativeSmoke.exe'
    & $taskCompiler /nologo /warnaserror+ /target:exe /main:NativeSmokeTests /r:System.Windows.Forms.dll /r:System.Drawing.dll /r:System.Web.Extensions.dll "/r:$taskInstallDirectory\WeeklyUsage.exe" "/out:$taskSmoke" "$PSScriptRoot\NativeSmoke.test.cs"
    if ($LASTEXITCODE -ne 0) { throw 'Installed application smoke driver did not compile.' }
    & $taskSmoke $taskInstallDirectory
    if ($LASTEXITCODE -ne 0) { throw 'Installed native onboarding checks failed.' }
    Remove-Item -LiteralPath $taskSmoke
    $taskConfig = Join-Path $taskInstallDirectory 'accounts.json'
    $taskCache = Join-Path $taskInstallDirectory 'usage-cache.json'
    Set-Content -LiteralPath $taskConfig -Encoding UTF8 -Value '{"accounts":[{"provider":"claude","email":"installer-test@example.com"}],"preserve":"upgrade-and-uninstall"}'
    Set-Content -LiteralPath $taskCache -Encoding UTF8 -Value '{"synthetic":"preserve-user-cache"}'
    $taskConfigHash = (Get-FileHash -LiteralPath $taskConfig).Hash
    $taskCacheHash = (Get-FileHash -LiteralPath $taskCache).Hash
    Invoke-TestProgram $taskInstaller ($taskArguments + ('/LOG="' + (Join-Path $taskRoot 'upgrade.log') + '"'))
    Assert-Installer ((Get-FileHash -LiteralPath $taskConfig).Hash -eq $taskConfigHash) 'upgrade preserves account configuration bytes'
    Assert-Installer ((Get-FileHash -LiteralPath $taskCache).Hash -eq $taskCacheHash) 'upgrade preserves cached user data'
    Remove-TestInstallation
    $taskInstalled = $false
    Assert-Installer (-not (Test-Path -LiteralPath (Join-Path $taskInstallDirectory 'WeeklyUsage.exe'))) 'uninstall removes executable'
    Assert-Installer (-not (Test-Path -LiteralPath $taskNode)) 'uninstall removes bundled runtime'
    Assert-Installer (-not (Test-Path -LiteralPath $taskUninstallKey)) 'uninstall removes its registry entry'
    Assert-Installer (-not (Test-Path -LiteralPath $taskShortcut)) 'uninstall removes its shortcut'
    Assert-Installer ((Get-FileHash -LiteralPath $taskConfig).Hash -eq $taskConfigHash) 'uninstall preserves account settings'
    Assert-Installer ((Get-FileHash -LiteralPath $taskCache).Hash -eq $taskCacheHash) 'uninstall preserves user cache'
    Assert-Installer ([Environment]::GetEnvironmentVariable('PATH', 'User') -eq $taskUserPath) 'user PATH stays unchanged'
    Assert-Installer ([Environment]::GetEnvironmentVariable('PATH', 'Machine') -eq $taskMachinePath) 'machine PATH stays unchanged'
    Write-Output "PASS: $taskChecks installer lifecycle checks. Logs: $taskRoot"
    Write-Output ('Installer signature: ' + (Get-AuthenticodeSignature -LiteralPath $taskInstaller).Status)
}
finally {
    if ($taskInstalled) { Remove-TestInstallation }
}
