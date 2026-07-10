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
# --stem-dir nests each project's output under <out>/<sspj-stem>/, so overall's
# many ssab land in <out>/overall/ and Ringo's in <out>/Ringo/.
node packages/ssconverter-web/scripts/cli.js --stem-dir -o "$PIXI_PUBLIC" SpriteStudio-SDK/tests/overall/overall.sspj
node packages/ssconverter-web/scripts/cli.js --stem-dir -o "$PIXI_PUBLIC" SpriteStudio-SDK/tests/Ringo/Ringo.sspj

# Also emit embedded-texture variants (*_embedded.ssab) so the examples can demo
# SSABs whose textures are inlined (no sibling image files needed).
echo "Compiling embedded-texture variants..."
node packages/ssconverter-web/scripts/cli.js --stem-dir --embedded --suffix _embedded -o "$PIXI_PUBLIC" SpriteStudio-SDK/tests/overall/overall.sspj
node packages/ssconverter-web/scripts/cli.js --stem-dir --embedded --suffix _embedded -o "$PIXI_PUBLIC" SpriteStudio-SDK/tests/Ringo/Ringo.sspj

# Copy compiled assets to webgl-example as well (the overall/ and Ringo/ subdirs).
cp -R "$PIXI_PUBLIC/"* "$WEBGL_PUBLIC/"

# tyrano-example uses the REFERENCE Ringo (ssab + sibling PNG), not the embedded
# variant, to exercise real texture-path resolution.
mkdir -p "$TYRANO_SSDATA/Ringo"
cp "$PIXI_PUBLIC/Ringo/Ringo.ssab" "$PIXI_PUBLIC/Ringo/Ringo.png" "$TYRANO_SSDATA/Ringo/"

# rmmz-example (RPG Maker MZ): convert the test .sspj into the game's asset
# folder (nested under img/spritestudio/<project>/). The MZ plugin build
# artefacts are synced separately by the example itself (examples/rmmz-example:
# pnpm run sync:plugin), mirroring tyrano-example — deploy-examples only
# publishes converted test assets.
RMMZ_SS="$ROOT_DIR/examples/rmmz-example/SampleProject/img/spritestudio"
mkdir -p "$RMMZ_SS"
node packages/ssconverter-web/scripts/cli.js --stem-dir -o "$RMMZ_SS" SpriteStudio-SDK/tests/Ringo/Ringo.sspj

echo "Deploy complete! Assets copied to examples/pixi-example/public, examples/webgl-example/public, examples/tyrano-example/data/others/ssdata and examples/rmmz-example/SampleProject/img/spritestudio."
