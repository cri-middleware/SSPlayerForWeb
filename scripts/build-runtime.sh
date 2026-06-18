#!/bin/bash
set -e

# Get absolute paths to avoid confusion with wasm-pack relative directories
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SSRUNTIME_DIR="$ROOT_DIR/SpriteStudio-SDK/libs/ssruntime"
OUT_DIR="$ROOT_DIR/packages/ssplayer-core/wasm"

echo "Building WASM runtime via release-web.sh..."
bash "$ROOT_DIR/SpriteStudio-SDK/scripts/release-web.sh"

echo "Copying generated WASM files..."
mkdir -p "$OUT_DIR"
cp -r "$ROOT_DIR/SpriteStudio-SDK/pkg/runtime-web/release/"* "$OUT_DIR/"

CONVERTER_OUT_DIR="$ROOT_DIR/packages/ssconverter-web/wasm"
echo "Copying generated converter WASM files..."
mkdir -p "$CONVERTER_OUT_DIR"
cp -r "$ROOT_DIR/SpriteStudio-SDK/pkg/converter-web/release/"* "$CONVERTER_OUT_DIR/"

echo "Copying licenses..."
cp "$ROOT_DIR/SpriteStudio-SDK/LICENSE.md" "$OUT_DIR/"
cp "$ROOT_DIR/SpriteStudio-SDK/LICENSE.md" "$CONVERTER_OUT_DIR/"
if [[ -f "$ROOT_DIR/SpriteStudio-SDK/target/licenses/THIRD-PARTY-LICENSES.ssruntime.md" ]]; then
    cp "$ROOT_DIR/SpriteStudio-SDK/target/licenses/THIRD-PARTY-LICENSES.ssruntime.md" "$OUT_DIR/"
fi

if [[ -f "$ROOT_DIR/SpriteStudio-SDK/target/licenses/THIRD-PARTY-LICENSES.ssconverter.md" ]]; then
    cp "$ROOT_DIR/SpriteStudio-SDK/target/licenses/THIRD-PARTY-LICENSES.ssconverter.md" "$CONVERTER_OUT_DIR/"
fi

echo "WASM build and copy complete!"
