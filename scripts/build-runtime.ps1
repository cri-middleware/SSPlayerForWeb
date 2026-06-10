$ErrorActionPreference = "Stop"

$RootDir = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$SdkDir = Join-Path $RootDir "SpriteStudio7-SDK"
$SsruntimeDir = Join-Path $SdkDir "libs\ssruntime"
$SdkReleaseDir = Join-Path $SdkDir "pkg\runtime-web\release"
$OutDir = Join-Path $RootDir "packages\ssplayer-core\wasm"

Write-Host "Building WASM runtime (Windows)..."

# Build using bash
Push-Location $SdkDir
try {
    $process = Start-Process bash -ArgumentList "scripts/release-web.sh" -Wait -NoNewWindow -PassThru
    if ($process.ExitCode -ne 0) {
        throw "release-web.sh failed."
    }
}
finally {
    Pop-Location
}

Write-Host "Copying generated WASM files..."
if (-not (Test-Path $OutDir)) {
    New-Item -ItemType Directory -Path $OutDir | Out-Null
}
Copy-Item -Path (Join-Path $SdkReleaseDir "*") -Destination $OutDir -Recurse -Force

$ConverterOutDir = Join-Path $RootDir "packages\ssconverter-web\wasm"
$ConverterSdkReleaseDir = Join-Path $SdkDir "pkg\converter-web\release"
Write-Host "Copying generated converter WASM files..."
if (-not (Test-Path $ConverterOutDir)) {
    New-Item -ItemType Directory -Path $ConverterOutDir | Out-Null
}
Copy-Item -Path (Join-Path $ConverterSdkReleaseDir "*") -Destination $ConverterOutDir -Recurse -Force

Write-Host "Copying licenses..."
if (Test-Path "$SdkDir\LICENSE.md") {
    Copy-Item "$SdkDir\LICENSE.md" "$OutDir\" -Force
    Copy-Item "$SdkDir\LICENSE.md" "$ConverterOutDir\" -Force
}
if (Test-Path "$SdkDir\target\licenses\THIRD-PARTY-LICENSES.ssruntime.md") {
    Copy-Item "$SdkDir\target\licenses\THIRD-PARTY-LICENSES.ssruntime.md" "$OutDir\" -Force
}
if (Test-Path "$SdkDir\target\licenses\THIRD-PARTY-LICENSES.ssconverter.md") {
    Copy-Item "$SdkDir\target\licenses\THIRD-PARTY-LICENSES.ssconverter.md" "$ConverterOutDir\" -Force
}

Write-Host "WASM build and copy complete!"
