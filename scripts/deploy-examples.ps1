$ErrorActionPreference = "Stop"

$ROOT_DIR = (Resolve-Path "$PSScriptRoot\..").Path
$PIXI_PUBLIC = Join-Path $ROOT_DIR "examples\pixi-example\public"
$WEBGL_PUBLIC = Join-Path $ROOT_DIR "examples\webgl-example\public"

if (!(Test-Path -Path $PIXI_PUBLIC)) {
    New-Item -ItemType Directory -Force -Path $PIXI_PUBLIC | Out-Null
}
if (!(Test-Path -Path $WEBGL_PUBLIC)) {
    New-Item -ItemType Directory -Force -Path $WEBGL_PUBLIC | Out-Null
}

Write-Host "Compiling SpriteStudio test assets..."
Set-Location -Path $ROOT_DIR

node packages/ssconverter-web/scripts/cli.js -o "$PIXI_PUBLIC" SpriteStudio-SDK/tests/overall/overall.sspj
node packages/ssconverter-web/scripts/cli.js -o "$PIXI_PUBLIC" SpriteStudio-SDK/tests/Ringo/Ringo.sspj

Copy-Item -Path "$PIXI_PUBLIC\*" -Destination $WEBGL_PUBLIC -Recurse -Force

Write-Host "Deploy complete! The .ssab and related asset files have been copied to $PIXI_PUBLIC and $WEBGL_PUBLIC."
