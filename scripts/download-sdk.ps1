# Fetch the pre-built WASM from the SpriteStudio-SDK GitHub Releases instead of
# building it from source. This lets you run the examples without a Rust /
# wasm-pack toolchain (`pnpm run build:wasm` remains the from-source path).
#
# NOTE (provisional): the SpriteStudio-SDK does not publish WASM release assets
# yet. Until a release is available, this script will fail at the download step
# — build from source with `pnpm run build:wasm:win` in the meantime.
#
# Asset names and layout follow SpriteStudio-SDK/.github/workflows/release.yml:
#   - spritestudio7-sdk-runtime-web.zip    -> packages/ssplayer-core/wasm/
#   - spritestudio7-sdk-converter-web.zip  -> packages/ssconverter-core/wasm/
# Both zips are flattened (`zip -rj`), so their files extract directly into the
# target directory.

$ErrorActionPreference = "Stop"

$baseDirectory = Split-Path -Parent $PSCommandPath
$rootDirectory = Split-Path -Parent $baseDirectory
$versionFile = "$rootDirectory/SDK_VERSION.txt"

$repo = "cri-middleware/SpriteStudio-SDK"
$runtimeDir = "$rootDirectory/packages/ssplayer-core/wasm"
$converterDir = "$rootDirectory/packages/ssconverter-core/wasm"
$versionMarker = "$runtimeDir/VERSION"

$targetVersion = (Get-Content $versionFile).Trim()

if (Test-Path $versionMarker) {
    $currentVersion = (Get-Content $versionMarker).Trim()
    if ($currentVersion -eq $targetVersion) {
        Write-Host "SDK WASM $targetVersion is already up to date. Skipping download."
        exit 0
    }
}

$baseUrl = "https://github.com/$repo/releases/download/$targetVersion"
$runtimeZipUrl = "$baseUrl/spritestudio7-sdk-runtime-web.zip"
$converterZipUrl = "$baseUrl/spritestudio7-sdk-converter-web.zip"

$tmpDir = Join-Path ([System.IO.Path]::GetTempPath()) ([System.IO.Path]::GetRandomFileName())
New-Item -ItemType Directory -Path $tmpDir | Out-Null

try {
    Write-Host "Target SDK Version: $targetVersion"

    $runtimeZip = "$tmpDir/runtime-web.zip"
    $converterZip = "$tmpDir/converter-web.zip"

    Write-Host "Downloading runtime WASM:   $runtimeZipUrl"
    Invoke-WebRequest -Uri $runtimeZipUrl -OutFile $runtimeZip

    Write-Host "Downloading converter WASM: $converterZipUrl"
    Invoke-WebRequest -Uri $converterZipUrl -OutFile $converterZip

    Write-Host "Extracting runtime WASM   -> $runtimeDir"
    New-Item -ItemType Directory -Force -Path $runtimeDir | Out-Null
    Expand-Archive -Path $runtimeZip -DestinationPath $runtimeDir -Force

    Write-Host "Extracting converter WASM -> $converterDir"
    New-Item -ItemType Directory -Force -Path $converterDir | Out-Null
    Expand-Archive -Path $converterZip -DestinationPath $converterDir -Force

    Set-Content -Path $versionMarker -Value $targetVersion

    Write-Host "Done."
}
finally {
    Remove-Item -Recurse -Force $tmpDir -ErrorAction SilentlyContinue
}
