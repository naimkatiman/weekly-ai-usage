$ErrorActionPreference = 'Stop'
& node --test "$PSScriptRoot\collect.test.cjs"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$taskCompiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path -LiteralPath $taskCompiler)) {
    $taskCompiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe'
}
$taskTestExe = Join-Path ([IO.Path]::GetTempPath()) ("WeeklyUsage-config-tests-" + [guid]::NewGuid().ToString('N') + '.exe')
try {
    & $taskCompiler /nologo /target:exe /warnaserror+ /r:System.Web.Extensions.dll "/out:$taskTestExe" "$PSScriptRoot\AccountConfiguration.cs" "$PSScriptRoot\AccountConfiguration.test.cs"
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    & $taskTestExe
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}
finally {
    if (Test-Path -LiteralPath $taskTestExe) { Remove-Item -LiteralPath $taskTestExe }
}

$taskNativeExe = Join-Path ([IO.Path]::GetTempPath()) ("WeeklyUsage-native-tests-" + [guid]::NewGuid().ToString('N') + '.exe')
try {
    & $taskCompiler /nologo /target:exe /warnaserror+ /main:NativeSmokeTests /r:System.Web.Extensions.dll /r:System.Windows.Forms.dll /r:System.Drawing.dll "/out:$taskNativeExe" "$PSScriptRoot\WeeklyUsage.cs" "$PSScriptRoot\AccountSetupForm.cs" "$PSScriptRoot\AccountConfiguration.cs" "$PSScriptRoot\NativeSmoke.test.cs"
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    & $taskNativeExe $PSScriptRoot
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}
finally {
    if (Test-Path -LiteralPath $taskNativeExe) { Remove-Item -LiteralPath $taskNativeExe }
}
