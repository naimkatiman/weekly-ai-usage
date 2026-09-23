$ErrorActionPreference = 'Stop'
$taskCompiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
& $taskCompiler /nologo /target:winexe /optimize+ /warnaserror+ /r:System.Windows.Forms.dll /r:System.Drawing.dll /r:System.Web.Extensions.dll /out:"$PSScriptRoot\WeeklyUsage.exe" "$PSScriptRoot\WeeklyUsage.cs"
if ($LASTEXITCODE -ne 0) { throw 'Dashboard compilation failed.' }
