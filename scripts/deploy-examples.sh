#!/bin/bash
set -e

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SDK_DIR="$ROOT_DIR/SpriteStudio-SDK"
PUBLIC_DIR="$ROOT_DIR/examples/pixi-example/public"

mkdir -p "$PUBLIC_DIR"

echo "Compiling SpriteStudio test assets..."
cd "$ROOT_DIR"
node packages/ssconverter-web/scripts/cli.js -o "$PUBLIC_DIR" SpriteStudio-SDK/tests/overall/overall.sspj
node packages/ssconverter-web/scripts/cli.js -o "$PUBLIC_DIR" SpriteStudio-SDK/tests/Ringo/Ringo.sspj

echo "Deploy complete! The .ssab and related asset files have been copied to $PUBLIC_DIR."
