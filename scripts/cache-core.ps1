# Test-only cache: the 30 MB WASM stays outside the production static assets.
$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
$taskCache = Join-Path $taskRoot '.test-cache'
$taskCore = (Get-Content -Raw -LiteralPath (Join-Path $taskRoot 'vendor/manifest.json') | ConvertFrom-Json).external[0]
New-Item -ItemType Directory -Force -Path $taskCache | Out-Null
foreach ($extension in @('js', 'wasm')) {
    $target = Join-Path $taskCache ('ffmpeg-core.' + $extension)
    if (-not (Test-Path -LiteralPath $target)) {
        Invoke-WebRequest -Uri ('https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/umd/ffmpeg-core.' + $extension) -OutFile ($target + '.download') -TimeoutSec 90
        Move-Item -LiteralPath ($target + '.download') -Destination $target
    }
    $expected = $taskCore.sha256.$extension
    if ((Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expected) {
        throw ('Core checksum mismatch: ' + $extension)
    }
}
