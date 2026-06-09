#!/bin/bash
set -e

# Get absolute paths to avoid confusion with wasm-pack relative directories
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SSRUNTIME_DIR="$ROOT_DIR/SpriteStudio7-SDK/libs/ssruntime"
OUT_DIR="$ROOT_DIR/packages/ssplayer-core/wasm"

echo "Building WASM runtime via release-web.sh..."
bash "$ROOT_DIR/SpriteStudio7-SDK/scripts/release-web.sh"

echo "Copying generated WASM files..."
mkdir -p "$OUT_DIR"
cp -r "$ROOT_DIR/SpriteStudio7-SDK/pkg/web/release/"* "$OUT_DIR/"

echo "WASM build and copy complete!"
