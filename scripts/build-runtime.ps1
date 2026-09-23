param (
    [Parameter(ValueFromRemainingArguments=$true)]
    [string[]]$ArgsList
)

$App = Split-Path -Leaf $PSCommandPath

function Fail {
    param([string] $Message, [int] $Code = 1)
    [Console]::Error.WriteLine("${App}: $Message")
    exit $Code
}

$Mode = "release"
foreach ($arg in $ArgsList) {
    switch -Regex ($arg) {
        '^build=(release|debug)$' { $Mode = $Matches[1]; break }
        '^build=' { Fail "build= takes release or debug, not '$($arg -replace '^build=')'" 2 }
        '^(-h|--help|help)$' {
            Write-Host "Usage: $App [build=release|debug]"
            Write-Host "  build=<mode>  wasm build profile (default release)"
            exit 0
        }
        default { Fail "unknown argument '$arg'" 2 }
    }
}

$ErrorActionPreference = "Stop"

$RootDir = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$SdkDir = Join-Path $RootDir "SpriteStudio-SDK"
$SsruntimeDir = Join-Path $SdkDir "libs\ssruntime"
$SdkReleaseDir = Join-Path $SdkDir "pkg\runtime-web\$Mode"
$OutDir = Join-Path $RootDir "packages\ssplayer-core\wasm"

Write-Host "Building WASM runtime (Windows) in $Mode mode..."

# Build using PowerShell
Push-Location $SdkDir
try {
    $process = Start-Process powershell -ArgumentList "-ExecutionPolicy", "Bypass", "-File", "scripts/release-web.ps1", $Mode -Wait -NoNewWindow -PassThru
    if ($process.ExitCode -ne 0) {
        throw "release-web.ps1 failed."
    }
}
finally {
    Pop-Location
}

Write-Host "Copying generated WASM files..."
if (-not (Test-Path $OutDir)) {
    New-Item -ItemType Directory -Path $OutDir | Out-Null
}
# wasm\VERSION names the SDK release download-sdk installed, and what follows
# replaces the WASM with this local build. Stamp it "local" first, so a later
# download:wasm sees a mismatch and reinstalls instead of skipping as up to date.
Set-Content -Path (Join-Path $OutDir "VERSION") -Value "local"
Copy-Item -Path (Join-Path $SdkReleaseDir "*") -Destination $OutDir -Recurse -Force

# No-SIMD runtime variant for RPG Maker MZ / NW.js (bundled Chromium lacks WASM
# simd128). Same wasm-bindgen interface as the SIMD build, so ssplayer-rmmz
# swaps only ssruntime_bg.wasm for this one (see its pack-plugin.mjs).
$NosimdOutDir = Join-Path $RootDir "packages\ssplayer-core\wasm-nosimd"
$NosimdSdkReleaseDir = Join-Path $SdkDir "pkg\runtime-web-nosimd\$Mode"
Write-Host "Copying no-SIMD runtime WASM (RPG Maker MZ / NW.js)..."
if (-not (Test-Path $NosimdOutDir)) {
    New-Item -ItemType Directory -Path $NosimdOutDir | Out-Null
}
Copy-Item -Path (Join-Path $NosimdSdkReleaseDir "*") -Destination $NosimdOutDir -Recurse -Force

$ConverterOutDir = Join-Path $RootDir "packages\ssconverter-core\wasm"
$ConverterSdkReleaseDir = Join-Path $SdkDir "pkg\converter-web\$Mode"
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
