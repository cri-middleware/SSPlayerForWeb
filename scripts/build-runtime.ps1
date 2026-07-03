param (
    [Parameter(ValueFromRemainingArguments=$true)]
    [string[]]$ArgsList
)

$Mode = "release"
foreach ($arg in $ArgsList) {
    if ($arg -match "^build=(.*)") {
        $Mode = $Matches[1]
    } elseif ($arg -eq "release" -or $arg -eq "debug") {
        $Mode = $arg
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
Copy-Item -Path (Join-Path $SdkReleaseDir "*") -Destination $OutDir -Recurse -Force

$ConverterOutDir = Join-Path $RootDir "packages\ssconverter-web\wasm"
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
