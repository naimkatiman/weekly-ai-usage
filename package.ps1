param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^\d+\.\d+\.\d+(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?$')]
    [string]$Version
)

$ErrorActionPreference = 'Stop'
# Only these public runtime files may enter the release. Never archive the checkout.
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
New-Item -ItemType Directory -Path $taskOutput -Force | Out-Null
$taskZipName = "WeeklyAIUsage-$Version-windows.zip"
$taskZipPath = Join-Path $taskOutput $taskZipName
$taskTemporaryZip = Join-Path $taskOutput ([guid]::NewGuid().ToString('N') + '.tmp')
Add-Type -AssemblyName System.IO.Compression, System.IO.Compression.FileSystem
try {
    $taskArchive = [IO.Compression.ZipFile]::Open($taskTemporaryZip, [IO.Compression.ZipArchiveMode]::Create)
    try {
        foreach ($taskFile in ($taskFiles | Sort-Object)) {
            $taskEntry = $taskArchive.CreateEntry($taskFile, [IO.Compression.CompressionLevel]::Optimal)
            $taskEntry.LastWriteTime = [DateTimeOffset]::new(2000, 1, 1, 0, 0, 0, [TimeSpan]::Zero)
            $taskSource = [IO.File]::OpenRead((Join-Path $PSScriptRoot $taskFile))
            try {
                $taskDestination = $taskEntry.Open()
                try { $taskSource.CopyTo($taskDestination) }
                finally { $taskDestination.Dispose() }
            }
            finally { $taskSource.Dispose() }
        }
    }
    finally { $taskArchive.Dispose() }
    Move-Item -LiteralPath $taskTemporaryZip -Destination $taskZipPath -Force
    $taskHash = (Get-FileHash -LiteralPath $taskZipPath -Algorithm SHA256).Hash.ToLowerInvariant()
    Set-Content -LiteralPath "$taskZipPath.sha256" -Value "$taskHash  $taskZipName" -Encoding ASCII
    Write-Output "Created $taskZipPath"
    Write-Output "SHA256 $taskHash"
}
finally {
    if (Test-Path -LiteralPath $taskTemporaryZip) { Remove-Item -LiteralPath $taskTemporaryZip }
}
