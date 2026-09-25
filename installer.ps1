param(
    [ValidatePattern('^\d+\.\d+\.\d+(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?$')]
    [string]$Version = '0.2.0-preview.1',
    [string]$CompilerPath = $env:ISCC_PATH
)

$ErrorActionPreference = 'Stop'
if (-not $CompilerPath) {
    $taskCompilerCommand = Get-Command ISCC.exe -ErrorAction SilentlyContinue
    $taskCompilerCandidates = @(
        $(if ($taskCompilerCommand) { $taskCompilerCommand.Source }),
        "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe",
        "$env:ProgramFiles\Inno Setup 6\ISCC.exe"
    )
    $CompilerPath = $taskCompilerCandidates | Where-Object { $_ -and (Test-Path -LiteralPath $_ -PathType Leaf) } | Select-Object -First 1
}
if (-not $CompilerPath -or -not (Test-Path -LiteralPath $CompilerPath -PathType Leaf)) {
    throw 'Inno Setup 6 compiler was not found. Build on the GitHub windows-2025 runner, or set -CompilerPath / ISCC_PATH to an existing ISCC.exe. This script does not install build tools.'
}

# Never package the checkout or any account configuration/credential files.
$taskFiles = @(
    'WeeklyUsage.exe', 'collect.cjs', 'grok.cjs', 'devin.cjs',
    'accounts.example.json', 'README.md', 'LICENSE', 'docs/troubleshooting.md', 'docs/onboarding.png'
)
if ((Get-Content -LiteralPath (Join-Path $PSScriptRoot 'README.md') -Raw) -match 'docs/screenshot\.png') {
    $taskFiles += 'docs/screenshot.png'
}
foreach ($taskFile in $taskFiles) {
    if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot $taskFile) -PathType Leaf)) {
        throw "Missing release file: $taskFile. Run test.ps1 and build.ps1 before packaging."
    }
}

$taskOutput = Join-Path $PSScriptRoot 'dist'
$taskBuildRoot = Join-Path $taskOutput ('installer-' + [guid]::NewGuid().ToString('N'))
$taskStage = Join-Path $taskBuildRoot 'app'
$taskRuntimeSource = Join-Path $taskBuildRoot 'runtime-source'
$taskCompilerOutput = Join-Path $taskBuildRoot 'output'
New-Item -ItemType Directory -Path $taskStage, $taskRuntimeSource, $taskCompilerOutput | Out-Null
foreach ($taskFile in $taskFiles) {
    $taskDestination = Join-Path $taskStage $taskFile
    New-Item -ItemType Directory -Path (Split-Path -Parent $taskDestination) -Force | Out-Null
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot $taskFile) -Destination $taskDestination
}

# Node is private to this application. No global install, npm, or PATH changes.
$taskNodeVersion = '24.21.0'
$taskNodeHash = '158f7685b44de51f6c0df1d153526cbcd3e1bc739a8dfc607721cef75de9e541'
$taskNodeArchive = Join-Path $taskRuntimeSource "node-v$taskNodeVersion-win-x64.zip"
$taskNodeUrl = "https://nodejs.org/dist/v$taskNodeVersion/node-v$taskNodeVersion-win-x64.zip"
Invoke-WebRequest -Uri $taskNodeUrl -OutFile $taskNodeArchive -UseBasicParsing
if ((Get-FileHash -LiteralPath $taskNodeArchive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $taskNodeHash) {
    throw "Node.js $taskNodeVersion download failed SHA256 verification. Nothing was extracted or packaged."
}
$taskExtracted = Join-Path $taskRuntimeSource 'extracted'
Expand-Archive -LiteralPath $taskNodeArchive -DestinationPath $taskExtracted
$taskNodeDirectory = Join-Path $taskExtracted "node-v$taskNodeVersion-win-x64"
$taskRuntime = Join-Path $taskStage 'runtime'
New-Item -ItemType Directory -Path $taskRuntime | Out-Null
foreach ($taskRuntimeFile in @('node.exe', 'LICENSE')) {
    Copy-Item -LiteralPath (Join-Path $taskNodeDirectory $taskRuntimeFile) -Destination (Join-Path $taskRuntime $taskRuntimeFile)
}

$taskNumericVersion = ($Version -split '-')[0] + '.0'
& $CompilerPath "/DAppVersion=$Version" "/DAppNumericVersion=$taskNumericVersion" "/DSourceDirectory=$taskStage" "/DOutputDirectory=$taskCompilerOutput" (Join-Path $PSScriptRoot 'installer.iss')
if ($LASTEXITCODE -ne 0) { throw "Inno Setup failed with exit code $LASTEXITCODE." }
$taskInstallerName = "WeeklyAIUsage-$Version-Setup-x64.exe"
$taskBuiltInstaller = Join-Path $taskCompilerOutput $taskInstallerName
if (-not (Test-Path -LiteralPath $taskBuiltInstaller -PathType Leaf)) {
    throw "Inno Setup did not produce $taskInstallerName."
}
$taskInstallerPath = Join-Path $taskOutput $taskInstallerName
Copy-Item -LiteralPath $taskBuiltInstaller -Destination $taskInstallerPath -Force
$taskInstallerHash = (Get-FileHash -LiteralPath $taskInstallerPath -Algorithm SHA256).Hash.ToLowerInvariant()
Set-Content -LiteralPath "$taskInstallerPath.sha256" -Value "$taskInstallerHash  $taskInstallerName" -Encoding ASCII
Write-Output "Created $taskInstallerPath"
Write-Output "SHA256 $taskInstallerHash"
