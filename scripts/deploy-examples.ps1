$ErrorActionPreference = "Stop"

$ROOT_DIR = (Resolve-Path "$PSScriptRoot\..").Path
$PIXI_PUBLIC = Join-Path $ROOT_DIR "examples\pixi-example\public"
$WEBGL_PUBLIC = Join-Path $ROOT_DIR "examples\webgl-example\public"
# TyranoScript serves assets from data/others/ssdata (see tyrano-example README).
$TYRANO_SSDATA = Join-Path $ROOT_DIR "examples\tyrano-example\data\others\ssdata"

if (!(Test-Path -Path $PIXI_PUBLIC)) {
    New-Item -ItemType Directory -Force -Path $PIXI_PUBLIC | Out-Null
}
if (!(Test-Path -Path $WEBGL_PUBLIC)) {
    New-Item -ItemType Directory -Force -Path $WEBGL_PUBLIC | Out-Null
}
if (!(Test-Path -Path $TYRANO_SSDATA)) {
    New-Item -ItemType Directory -Force -Path $TYRANO_SSDATA | Out-Null
}

Write-Host "Compiling SpriteStudio test assets..."
Set-Location -Path $ROOT_DIR

node packages/ssconverter-web/scripts/cli.js -o "$PIXI_PUBLIC" SpriteStudio-SDK/tests/overall/overall.sspj
node packages/ssconverter-web/scripts/cli.js -o "$PIXI_PUBLIC" SpriteStudio-SDK/tests/Ringo/Ringo.sspj

# Also emit embedded-texture variants (*_embedded.ssab) so the examples can demo
# SSABs whose textures are inlined (no sibling image files needed).
Write-Host "Compiling embedded-texture variants..."
node packages/ssconverter-web/scripts/cli.js --embedded --suffix _embedded -o "$PIXI_PUBLIC" SpriteStudio-SDK/tests/overall/overall.sspj
node packages/ssconverter-web/scripts/cli.js --embedded --suffix _embedded -o "$PIXI_PUBLIC" SpriteStudio-SDK/tests/Ringo/Ringo.sspj

Copy-Item -Path "$PIXI_PUBLIC\*" -Destination $WEBGL_PUBLIC -Recurse -Force

# tyrano-example uses the REFERENCE Ringo (ssab + sibling PNG), not the embedded
# variant, to exercise real texture-path resolution.
Copy-Item -Path (Join-Path $PIXI_PUBLIC "Ringo.ssab"), (Join-Path $PIXI_PUBLIC "Ringo.png") -Destination $TYRANO_SSDATA -Force

Write-Host "Deploy complete! The .ssab and related asset files have been copied to $PIXI_PUBLIC, $WEBGL_PUBLIC and $TYRANO_SSDATA."
