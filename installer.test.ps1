param([Parameter(Mandatory = $true)][string]$InstallerPath)

$ErrorActionPreference = 'Stop'
$taskInstaller = (Resolve-Path -LiteralPath $InstallerPath).Path
if (-not (Test-Path -LiteralPath $taskInstaller -PathType Leaf) -or [IO.Path]::GetExtension($taskInstaller) -ne '.exe') {
    throw 'Installer QA requires the candidate Setup executable.'
}
$taskDevelopmentNode = (Get-Command node.exe -CommandType Application -ErrorAction Stop).Source
$taskAppKey = '{BCD80182-BC56-4F3D-9608-14E0F73C8493}_is1'
$taskUninstallKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\' + $taskAppKey
$taskExistingKeys = @($taskUninstallKey,
    ('HKCU:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\' + $taskAppKey),
    ('HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\' + $taskAppKey),
    ('HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\' + $taskAppKey))
$taskShortcutFolder = Join-Path ([Environment]::GetFolderPath('Programs')) 'Weekly AI Usage'
$taskShortcut = Join-Path $taskShortcutFolder 'Weekly AI Usage.lnk'
if (($taskExistingKeys | Where-Object { Test-Path -LiteralPath $_ }) -or (Test-Path -LiteralPath $taskShortcutFolder)) {
    throw 'An existing Weekly AI Usage installation or shortcut is present. Installer QA will not replace it.'
}
$taskRoot = Join-Path ([IO.Path]::GetTempPath()) ('WeeklyUsage-installer-tests-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $taskRoot | Out-Null
$taskRoot = (Resolve-Path -LiteralPath $taskRoot).Path
$taskInstallDirectory = Join-Path $taskRoot 'app'
$taskExecutable = Join-Path $taskInstallDirectory 'WeeklyUsage.exe'
$taskUninstaller = Join-Path $taskInstallDirectory 'unins000.exe'
$taskUserPath = [Environment]::GetEnvironmentVariable('PATH', 'User')
$taskMachinePath = [Environment]::GetEnvironmentVariable('PATH', 'Machine')
$taskInstalled = $false
$taskUninstallAttempted = $false
$taskFailure = $null
$taskChecks = 0

function Assert-Installer([bool]$Condition, [string]$Message) {
    if (-not $Condition) { throw "Installer QA failed: $Message" }
    $script:taskChecks++
}
function Assert-OwnedTarget {
    if ((Get-Item -LiteralPath $taskRoot).Attributes -band [IO.FileAttributes]::ReparsePoint) {
        throw 'Installer test root must not be a reparse point.'
    }
    if (-not [IO.Path]::GetFullPath($taskInstallDirectory).StartsWith($taskRoot + '\', [StringComparison]::OrdinalIgnoreCase)) {
        throw 'Installer test target escaped its isolated root.'
    }
    if ((Test-Path -LiteralPath $taskInstallDirectory) -and
        ((Get-Item -LiteralPath $taskInstallDirectory).Attributes -band [IO.FileAttributes]::ReparsePoint)) {
        throw 'Installer test target must not be a reparse point.'
    }
}
function Invoke-TestProgram([string]$Label, [string]$File, [string[]]$Arguments, [int]$Timeout = 120000) {
    $taskOut = Join-Path $taskRoot ($Label + '.stdout.log')
    $taskErr = Join-Path $taskRoot ($Label + '.stderr.log')
    $taskProcess = Start-Process -FilePath $File -ArgumentList $Arguments -WorkingDirectory $PSScriptRoot `
        -RedirectStandardOutput $taskOut -RedirectStandardError $taskErr -PassThru -WindowStyle Hidden
    try {
        # Windows PowerShell 5 can otherwise lose ExitCode after a redirected
        # child exits. Retain its native handle before waiting for termination.
        [void]$taskProcess.Handle
        if (-not $taskProcess.WaitForExit($Timeout)) {
            try { $taskProcess.Kill($true) } catch { if (-not $taskProcess.HasExited) { $taskProcess.Kill() } }
            throw "Installer QA stage timed out: $Label"
        }
        $taskProcess.Refresh()
        $taskExitCode = $taskProcess.ExitCode
        if ($null -eq $taskExitCode) { throw "Installer QA could not read the exit code: $Label." }
        if ($taskExitCode -ne 0) { throw "Installer QA stage failed: $Label (exit $taskExitCode)." }
    } finally { $taskProcess.Dispose() }
}
function Assert-OwnedRegistration {
    if (Test-Path -LiteralPath $taskUninstallKey) {
        $taskRegistered = Get-ItemProperty -LiteralPath $taskUninstallKey
        if ($taskRegistered.InstallLocation.TrimEnd('\') -ne $taskInstallDirectory.TrimEnd('\')) {
            throw 'Refusing to uninstall: registration points outside the isolated test directory.'
        }
    }
}
function Check-Shortcut {
    Assert-Installer (Test-Path -LiteralPath $taskShortcut) 'Start Menu shortcut exists'
    $taskShell = New-Object -ComObject WScript.Shell
    $taskLink = $null
    try {
        $taskLink = $taskShell.CreateShortcut($taskShortcut)
        Assert-Installer ($taskLink.TargetPath -eq $taskExecutable) 'shortcut opens the installed executable'
        Assert-Installer ($taskLink.WorkingDirectory -eq $taskInstallDirectory) 'shortcut uses its installation directory'
    } finally {
        if ($taskLink) { [Runtime.InteropServices.Marshal]::FinalReleaseComObject($taskLink) | Out-Null }
        [Runtime.InteropServices.Marshal]::FinalReleaseComObject($taskShell) | Out-Null
    }
}
function Remove-TestInstallation {
    if ($script:taskUninstallAttempted) { return }
    $script:taskUninstallAttempted = $true
    Assert-OwnedTarget
    Assert-OwnedRegistration
    if (Test-Path -LiteralPath $taskShortcut) { Check-Shortcut }
    if (Test-Path -LiteralPath $taskUninstaller) {
        Invoke-TestProgram 'uninstall' $taskUninstaller @('/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', ('/LOG="' + (Join-Path $taskRoot 'uninstall.log') + '"'))
        $taskDeadline = [DateTime]::UtcNow.AddSeconds(20)
        while (((Test-Path -LiteralPath $taskUninstallKey) -or (Test-Path -LiteralPath $taskUninstaller)) -and [DateTime]::UtcNow -lt $taskDeadline) {
            Start-Sleep -Milliseconds 100
        }
        Assert-Installer (-not (Test-Path -LiteralPath $taskUninstaller)) 'uninstaller finishes self-removal'
    }
    $script:taskInstalled = $false
}

try {
    Assert-OwnedTarget
    $taskArguments = @('/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/SP-', ('/DIR="' + $taskInstallDirectory + '"'))
    $taskInstalled = $true
    Invoke-TestProgram 'install' $taskInstaller ($taskArguments + ('/LOG="' + (Join-Path $taskRoot 'install.log') + '"'))
    Assert-Installer (Test-Path -LiteralPath $taskUninstallKey) 'per-user uninstall entry exists'
    Assert-OwnedRegistration
    Check-Shortcut
    foreach ($taskRelative in @('WeeklyUsage.exe', 'resources\app.asar', 'resources\runtime\node.exe', 'resources\runtime\LICENSE',
        'resources\launcher\core\profiles.cjs', 'resources\launcher\core\launch.cjs', 'resources\launcher\core\terminal-runner.cjs')) {
        Assert-Installer (Test-Path -LiteralPath (Join-Path $taskInstallDirectory $taskRelative) -PathType Leaf) "installed package contains $taskRelative"
    }
    foreach ($taskPrivateFile in @('accounts.json', 'usage-cache.json', 'profile-store.json', 'quota-cache.json', 'auth.json', '.credentials.json')) {
        Assert-Installer (-not (Test-Path -LiteralPath (Join-Path $taskInstallDirectory $taskPrivateFile))) 'installer ships no private account state'
    }
    # Scan the installed ASAR and resources before adding any synthetic old data.
    Invoke-TestProgram 'installed-privacy' $taskDevelopmentNode @(('"' + (Join-Path $PSScriptRoot 'scripts\privacy-check.cjs') + '"'), '--artifact', ('"' + $taskInstallDirectory + '"'))
    $taskNode = Join-Path $taskInstallDirectory 'resources\runtime\node.exe'
    Invoke-TestProgram 'runtime-version' $taskNode @('--version')
    Assert-Installer ((Get-Content -LiteralPath (Join-Path $taskRoot 'runtime-version.stdout.log') -Raw).Trim() -eq 'v24.21.0') 'bundled runtime starts at the pinned version'
    # E2E passes --smoke-root to the installed app and tests its actual bundled
    # Node/launcher with synthetic homes. No real userData or provider login opens.
    Invoke-TestProgram 'installed-desktop' $taskDevelopmentNode @(('"' + (Join-Path $PSScriptRoot 'desktop\e2e.cjs') + '"'), '--packaged', ('"' + $taskExecutable + '"')) 180000
    Assert-Installer ((Get-Content -LiteralPath (Join-Path $taskRoot 'installed-desktop.stdout.log') -Raw) -match 'PASS: \d+ Electron desktop checks') 'installed desktop and bundled terminal helper pass E2E'
    $taskConfig = Join-Path $taskInstallDirectory 'accounts.json'
    $taskCache = Join-Path $taskInstallDirectory 'usage-cache.json'
    Set-Content -LiteralPath $taskConfig -Encoding UTF8 -Value '{"accounts":[{"provider":"claude","email":"installer-test@example.com"}],"preserve":"upgrade-and-uninstall"}'
    Set-Content -LiteralPath $taskCache -Encoding UTF8 -Value '{"synthetic":"preserve-user-cache"}'
    $taskConfigHash = (Get-FileHash -LiteralPath $taskConfig).Hash
    $taskCacheHash = (Get-FileHash -LiteralPath $taskCache).Hash
    Assert-OwnedTarget
    Assert-OwnedRegistration
    Invoke-TestProgram 'upgrade' $taskInstaller ($taskArguments + ('/LOG="' + (Join-Path $taskRoot 'upgrade.log') + '"'))
    Assert-OwnedRegistration
    Check-Shortcut
    Assert-Installer ((Get-FileHash -LiteralPath $taskConfig).Hash -eq $taskConfigHash) 'upgrade preserves legacy configuration bytes'
    Assert-Installer ((Get-FileHash -LiteralPath $taskCache).Hash -eq $taskCacheHash) 'upgrade preserves legacy cache bytes'
    Remove-TestInstallation
    foreach ($taskRemoved in @($taskExecutable, $taskNode, (Join-Path $taskInstallDirectory 'resources\app.asar'),
        (Join-Path $taskInstallDirectory 'resources\launcher\core\terminal-runner.cjs'), $taskUninstallKey, $taskShortcut)) {
        Assert-Installer (-not (Test-Path -LiteralPath $taskRemoved)) 'uninstall removes installed code and registration'
    }
    Assert-Installer ((Get-FileHash -LiteralPath $taskConfig).Hash -eq $taskConfigHash) 'uninstall preserves legacy account settings'
    Assert-Installer ((Get-FileHash -LiteralPath $taskCache).Hash -eq $taskCacheHash) 'uninstall preserves legacy cache'
    Assert-Installer ([Environment]::GetEnvironmentVariable('PATH', 'User') -eq $taskUserPath) 'user PATH stays unchanged'
    Assert-Installer ([Environment]::GetEnvironmentVariable('PATH', 'Machine') -eq $taskMachinePath) 'machine PATH stays unchanged'
    Write-Output "PASS: $taskChecks Electron installer lifecycle checks."
    Write-Output ('Installer signature: ' + (Get-AuthenticodeSignature -LiteralPath $taskInstaller).Status)
} catch {
    $taskFailure = $_
    throw
} finally {
    if ($taskInstalled -and -not $taskUninstallAttempted) {
        try { Remove-TestInstallation }
        catch {
            if (-not $taskFailure) { throw }
            Write-Warning 'Installer QA cleanup also failed. The original stage failure is preserved.' -WarningAction Continue
        }
    }
}
