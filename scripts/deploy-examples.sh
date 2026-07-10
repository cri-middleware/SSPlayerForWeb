#!/bin/bash
set -e

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SDK_DIR="$ROOT_DIR/SpriteStudio-SDK"
PIXI_PUBLIC="$ROOT_DIR/examples/pixi-example/public"
WEBGL_PUBLIC="$ROOT_DIR/examples/webgl-example/public"
# TyranoScript serves assets from data/others/ssdata (see tyrano-example README).
TYRANO_SSDATA="$ROOT_DIR/examples/tyrano-example/data/others/ssdata"

mkdir -p "$PIXI_PUBLIC"
mkdir -p "$WEBGL_PUBLIC"
mkdir -p "$TYRANO_SSDATA"

echo "Compiling SpriteStudio test assets..."
cd "$ROOT_DIR"
node packages/ssconverter-web/scripts/cli.js -o "$PIXI_PUBLIC" SpriteStudio-SDK/tests/overall/overall.sspj
node packages/ssconverter-web/scripts/cli.js -o "$PIXI_PUBLIC" SpriteStudio-SDK/tests/Ringo/Ringo.sspj

# Also emit embedded-texture variants (*_embedded.ssab) so the examples can demo
# SSABs whose textures are inlined (no sibling image files needed).
echo "Compiling embedded-texture variants..."
node packages/ssconverter-web/scripts/cli.js --embedded --suffix _embedded -o "$PIXI_PUBLIC" SpriteStudio-SDK/tests/overall/overall.sspj
node packages/ssconverter-web/scripts/cli.js --embedded --suffix _embedded -o "$PIXI_PUBLIC" SpriteStudio-SDK/tests/Ringo/Ringo.sspj

# Copy compiled assets to webgl-example as well
cp -R "$PIXI_PUBLIC/"* "$WEBGL_PUBLIC/"

# tyrano-example uses the REFERENCE Ringo (ssab + sibling PNG), not the embedded
# variant, to exercise real texture-path resolution.
cp "$PIXI_PUBLIC/Ringo.ssab" "$PIXI_PUBLIC/Ringo.png" "$TYRANO_SSDATA/"

echo "Deploy complete! The .ssab and related asset files have been copied to examples/pixi-example/public, examples/webgl-example/public and examples/tyrano-example/data/others/ssdata."
