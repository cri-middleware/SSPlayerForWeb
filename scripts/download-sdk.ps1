# Fetch the pre-built WASM from the SpriteStudio-SDK GitHub Releases instead of
# building it from source. This lets you run the examples without a Rust /
# wasm-pack toolchain (`pnpm run build:wasm` remains the from-source path).
#
# NOTE (provisional): until a SpriteStudio-SDK release that publishes the WASM
# assets is available, this script fails at the download step — build from
# source with `pnpm run build:wasm:win` in the meantime.
#
# The SDK publishes one combined archive, spritestudio-sdk-web-libs.zip, holding the
# three wasm-pack packages as subdirectories. Each is extracted into its target:
#   - runtime-web/         -> packages/ssplayer-core/wasm/
#   - runtime-web-nosimd/  -> packages/ssplayer-core/wasm-nosimd/
#   - converter-web/       -> packages/ssconverter-core/wasm/
# The no-SIMD runtime variant is consumed by ssplayer-rmmz (RPG Maker MZ / NW.js
# lacks WASM simd128).

$ErrorActionPreference = "Stop"

$HelpApp = Split-Path -Leaf $PSCommandPath
function Show-Usage {
    Write-Host "Usage: ${HelpApp} [--help]"
    Write-Host "  Install the SpriteStudio-SDK WASM release pinned by scripts/SDK_VERSION.txt into"
    Write-Host "  ssplayer-core/wasm, ssplayer-core/wasm-nosimd and ssconverter-core/wasm."
    Write-Host "  Skips the download when that version is already in place."
}

foreach ($arg in $args) {
    switch -Regex ($arg) {
        '^(-h|--help|help)$' { Show-Usage; exit 0 }
        default {
            [Console]::Error.WriteLine("${HelpApp}: unknown argument '$arg'")
            Show-Usage
            exit 2
        }
    }
}

$baseDirectory = Split-Path -Parent $PSCommandPath
$rootDirectory = Split-Path -Parent $baseDirectory
$versionFile = "$baseDirectory/SDK_VERSION.txt"

$repo = "cri-middleware/SpriteStudio-SDK"
$runtimeDir = "$rootDirectory/packages/ssplayer-core/wasm"
$runtimeNosimdDir = "$rootDirectory/packages/ssplayer-core/wasm-nosimd"
$converterDir = "$rootDirectory/packages/ssconverter-core/wasm"
$versionMarker = "$runtimeDir/VERSION"
# Downloaded zip is cached here (gitignored) so a re-run that needs the same
# version reuses it instead of re-downloading.
$cacheDir = "$baseDirectory/.sdk-cache"

$targetVersion = (Get-Content $versionFile).Trim()

if (Test-Path $versionMarker) {
    $currentVersion = (Get-Content $versionMarker).Trim()
    if ($currentVersion -eq $targetVersion) {
        Write-Host "SDK WASM $targetVersion is already up to date. Skipping download."
        exit 0
    }
}

$baseUrl = "https://github.com/$repo/releases/download/$targetVersion"
# Keep the release asset's own name so it matches the SHA256SUMS entry directly.
$webAsset = "spritestudio-sdk-web-libs.zip"
$sumsFile = "$cacheDir/SHA256SUMS"

Write-Host "Target SDK Version: $targetVersion"
New-Item -ItemType Directory -Force -Path $cacheDir | Out-Null

function Get-Sha256($file) { (Get-FileHash -Algorithm SHA256 -Path $file).Hash.ToLower() }

# Fetch the checksum manifest (small): it both verifies integrity and decides
# whether an already-cached zip can be reused without re-downloading.
Write-Host "Downloading checksum manifest:   $baseUrl/SHA256SUMS"
Invoke-WebRequest -Uri "$baseUrl/SHA256SUMS" -OutFile $sumsFile

# Leave a checksum-verified copy of the asset in the cache under its own name,
# reusing an already-matching one instead of re-downloading.
function Confirm-Asset($asset) {
    $file = "$cacheDir/$asset"
    $expected = $null
    foreach ($line in Get-Content $sumsFile) {
        $parts = $line -split '\s+', 2
        if ($parts.Count -eq 2 -and $parts[1].Trim() -eq $asset) { $expected = $parts[0].ToLower(); break }
    }
    if (-not $expected) {
        Write-Error "No checksum entry for $asset in SHA256SUMS"
    }
    if ((Test-Path $file) -and ((Get-Sha256 $file) -eq $expected)) {
        Write-Host "Reusing cached $asset"
    } else {
        Write-Host "Downloading $baseUrl/$asset"
        Invoke-WebRequest -Uri "$baseUrl/$asset" -OutFile $file
        if ((Get-Sha256 $file) -ne $expected) {
            Remove-Item -Force $file
            Write-Error "Checksum mismatch for $asset"
        }
    }
    Write-Host "Checksum OK: $asset"
}

Confirm-Asset $webAsset

# The archive holds runtime-web/, runtime-web-nosimd/ and converter-web/ as
# subdirectories. Expand it to a temp, then copy each subdir's contents into its
# target directory (as the packages expect them, flat).
Write-Host "Extracting web WASM packages..."
$tmpDir = Join-Path ([System.IO.Path]::GetTempPath()) ([System.IO.Path]::GetRandomFileName())
New-Item -ItemType Directory -Force -Path $tmpDir | Out-Null
try {
    Expand-Archive -Path "$cacheDir/$webAsset" -DestinationPath $tmpDir -Force

    Write-Host "  runtime WASM          -> $runtimeDir"
    New-Item -ItemType Directory -Force -Path $runtimeDir | Out-Null
    Copy-Item -Path "$tmpDir/runtime-web/*" -Destination $runtimeDir -Recurse -Force

    Write-Host "  runtime WASM (nosimd) -> $runtimeNosimdDir"
    New-Item -ItemType Directory -Force -Path $runtimeNosimdDir | Out-Null
    Copy-Item -Path "$tmpDir/runtime-web-nosimd/*" -Destination $runtimeNosimdDir -Recurse -Force

    Write-Host "  converter WASM        -> $converterDir"
    New-Item -ItemType Directory -Force -Path $converterDir | Out-Null
    Copy-Item -Path "$tmpDir/converter-web/*" -Destination $converterDir -Recurse -Force
} finally {
    Remove-Item -Recurse -Force $tmpDir -ErrorAction SilentlyContinue
}

Set-Content -Path $versionMarker -Value $targetVersion

Write-Host "Done."
