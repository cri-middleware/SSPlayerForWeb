$ErrorActionPreference = "Stop"

$RootDir = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$SdkDir = Join-Path $RootDir "SpriteStudio7-SDK"
$SsruntimeDir = Join-Path $SdkDir "libs\ssruntime"
$SdkReleaseDir = Join-Path $SdkDir "pkg\web\release"
$OutDir = Join-Path $RootDir "packages\ssplayer-core\wasm"

Write-Host "Building WASM runtime (Windows)..."

# Prepare
Copy-Item -Path (Join-Path $SdkDir "LICENSE.md") -Destination (Join-Path $SsruntimeDir "LICENSE.md") -Force
if (Test-Path $SdkReleaseDir) {
    Remove-Item -Path $SdkReleaseDir -Recurse -Force
}

# Build
Push-Location $SdkDir
try {
    wasm-pack build libs/ssruntime --target web --out-dir ../../pkg/web/release -- --features web --no-default-features
    if ($LASTEXITCODE -ne 0) {
        throw "wasm-pack build failed."
    }
}
finally {
    Pop-Location
    Remove-Item -Path (Join-Path $SsruntimeDir "LICENSE.md") -Force
}

Write-Host "Copying generated WASM files..."
if (-not (Test-Path $OutDir)) {
    New-Item -ItemType Directory -Path $OutDir | Out-Null
}
Copy-Item -Path (Join-Path $SdkReleaseDir "*") -Destination $OutDir -Recurse -Force

Write-Host "WASM build and copy complete!"
