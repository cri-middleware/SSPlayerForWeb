$ErrorActionPreference = "Stop"

$ROOT_DIR = (Resolve-Path "$PSScriptRoot\..").Path
$PUBLIC_DIR = Join-Path $ROOT_DIR "examples\pixi-example\public"

if (!(Test-Path -Path $PUBLIC_DIR)) {
    New-Item -ItemType Directory -Force -Path $PUBLIC_DIR | Out-Null
}

Write-Host "Compiling SpriteStudio test assets..."
Set-Location -Path $ROOT_DIR

node packages/ssconverter-web/scripts/cli.js -o "$PUBLIC_DIR" SpriteStudio-SDK/tests/overall/overall.sspj
node packages/ssconverter-web/scripts/cli.js -o "$PUBLIC_DIR" SpriteStudio-SDK/tests/Ringo/Ringo.sspj

Write-Host "Deploy complete! The .ssab and related asset files have been copied to $PUBLIC_DIR."
