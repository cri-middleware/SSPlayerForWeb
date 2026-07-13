# Fetch the pre-built WASM from the SpriteStudio-SDK GitHub Releases instead of
# building it from source. This lets you run the examples without a Rust /
# wasm-pack toolchain (`pnpm run build:wasm` remains the from-source path).
#
# NOTE (provisional): until a SpriteStudio-SDK release that publishes the WASM
# assets is available, this script fails at the download step — build from
# source with `pnpm run build:wasm:win` in the meantime.
#
# Asset names and layout follow SpriteStudio-SDK/.github/workflows/release.yml:
#   - spritestudio-sdk-runtime-web.zip         -> packages/ssplayer-core/wasm/
#   - spritestudio-sdk-runtime-web-nosimd.zip  -> packages/ssplayer-core/wasm-nosimd/
#   - spritestudio-sdk-converter-web.zip       -> packages/ssconverter-core/wasm/
# Both zips are flattened (`zip -rj`), so their files extract directly into the
# target directory. The no-SIMD runtime variant is consumed by ssplayer-rmmz
# (RPG Maker MZ / NW.js lacks WASM simd128).

$ErrorActionPreference = "Stop"

$baseDirectory = Split-Path -Parent $PSCommandPath
$rootDirectory = Split-Path -Parent $baseDirectory
$versionFile = "$baseDirectory/SDK_VERSION.txt"

$repo = "cri-middleware/SpriteStudio-SDK"
$runtimeDir = "$rootDirectory/packages/ssplayer-core/wasm"
$runtimeNosimdDir = "$rootDirectory/packages/ssplayer-core/wasm-nosimd"
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
$runtimeAsset = "spritestudio-sdk-runtime-web.zip"
$runtimeNosimdAsset = "spritestudio-sdk-runtime-web-nosimd.zip"
$converterAsset = "spritestudio-sdk-converter-web.zip"

$tmpDir = Join-Path ([System.IO.Path]::GetTempPath()) ([System.IO.Path]::GetRandomFileName())
New-Item -ItemType Directory -Path $tmpDir | Out-Null
$sumsFile = "$tmpDir/SHA256SUMS"

try {
    Write-Host "Target SDK Version: $targetVersion"

    # Verify <file> against the release's SHA256SUMS manifest entry for
    # <asset-name> before extracting, so a corrupted or tampered download fails
    # loudly. Get-FileHash returns an upper-case hash; sha256sum writes
    # lower-case, so compare case-insensitively.
    function Assert-Sha256($file, $name) {
        $expected = $null
        foreach ($line in Get-Content $sumsFile) {
            $parts = $line -split '\s+', 2
            if ($parts.Count -eq 2 -and $parts[1].Trim() -eq $name) { $expected = $parts[0].ToLower(); break }
        }
        if (-not $expected) {
            Write-Error "No checksum entry for $name in SHA256SUMS"
        }
        $actual = (Get-FileHash -Algorithm SHA256 -Path $file).Hash.ToLower()
        if ($expected -ne $actual) {
            Write-Error "Checksum mismatch for $name`n  expected: $expected`n  actual:   $actual"
        }
        Write-Host "Checksum OK: $name"
    }

    Write-Host "Downloading checksum manifest:   $baseUrl/SHA256SUMS"
    Invoke-WebRequest -Uri "$baseUrl/SHA256SUMS" -OutFile $sumsFile

    foreach ($asset in @($runtimeAsset, $runtimeNosimdAsset, $converterAsset)) {
        Write-Host "Downloading $baseUrl/$asset"
        Invoke-WebRequest -Uri "$baseUrl/$asset" -OutFile "$tmpDir/$asset"
        Assert-Sha256 "$tmpDir/$asset" $asset
    }

    Write-Host "Extracting runtime WASM          -> $runtimeDir"
    New-Item -ItemType Directory -Force -Path $runtimeDir | Out-Null
    Expand-Archive -Path "$tmpDir/$runtimeAsset" -DestinationPath $runtimeDir -Force

    Write-Host "Extracting runtime WASM (nosimd) -> $runtimeNosimdDir"
    New-Item -ItemType Directory -Force -Path $runtimeNosimdDir | Out-Null
    Expand-Archive -Path "$tmpDir/$runtimeNosimdAsset" -DestinationPath $runtimeNosimdDir -Force

    Write-Host "Extracting converter WASM        -> $converterDir"
    New-Item -ItemType Directory -Force -Path $converterDir | Out-Null
    Expand-Archive -Path "$tmpDir/$converterAsset" -DestinationPath $converterDir -Force

    Set-Content -Path $versionMarker -Value $targetVersion

    Write-Host "Done."
}
finally {
    Remove-Item -Recurse -Force $tmpDir -ErrorAction SilentlyContinue
}
