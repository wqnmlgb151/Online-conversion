$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
$taskManifest = Get-Content -Raw -LiteralPath (Join-Path $taskRoot 'vendor/manifest.json') | ConvertFrom-Json
foreach ($library in $taskManifest.libraries) {
    for ($i = 0; $i -lt $library.files.Count; $i++) {
        $target = [IO.Path]::GetFullPath((Join-Path $taskRoot $library.files[$i]))
        if (-not $target.StartsWith((Join-Path $taskRoot 'vendor') + [IO.Path]::DirectorySeparatorChar)) {
            throw 'Download target must remain inside vendor'
        }
        if (Test-Path -LiteralPath $target) { continue }
        New-Item -ItemType Directory -Force -Path (Split-Path -Parent $target) | Out-Null
        $temporary = $target + '.download'
        Invoke-WebRequest -Uri $library.urls[$i] -OutFile $temporary -TimeoutSec 60
        Move-Item -LiteralPath $temporary -Destination $target
        Write-Output ($library.name + ': ' + $library.files[$i])
    }
}
