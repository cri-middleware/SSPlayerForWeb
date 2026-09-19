#!/bin/bash
set -eo pipefail

# Get absolute paths to avoid confusion with wasm-pack relative directories
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SSRUNTIME_DIR="$ROOT_DIR/SpriteStudio-SDK/libs/ssruntime"
OUT_DIR="$ROOT_DIR/packages/ssplayer-core/wasm"
APP="$(basename "$0")"

MODE="release"

usage () {
    echo "Usage: ${APP} [build=release|debug]"
    echo "  build=<mode>  wasm build profile (default release)"
}

for arg in "$@"; do
    case $arg in
        build=release|build=debug) MODE="${arg#*=}" ;;
        build=*) echo "${APP}: build= takes release or debug, not '${arg#*=}'" >&2; exit 2 ;;
        -h|--help|help) usage; exit 0 ;;
        *) echo "${APP}: unknown argument '${arg}'" >&2; usage >&2; exit 2 ;;
    esac
done
echo "Building WASM runtime via release-web.sh in $MODE mode..."
bash "$ROOT_DIR/SpriteStudio-SDK/scripts/release-web.sh" "$MODE"

echo "Copying generated WASM files..."
mkdir -p "$OUT_DIR"
cp -r "$ROOT_DIR/SpriteStudio-SDK/pkg/runtime-web/$MODE/"* "$OUT_DIR/"

# No-SIMD runtime variant for RPG Maker MZ / NW.js (bundled Chromium lacks WASM
# simd128). Same wasm-bindgen interface as the SIMD build, so ssplayer-rmmz
# swaps only ssruntime_bg.wasm for this one (see its pack-plugin.mjs).
NOSIMD_OUT_DIR="$ROOT_DIR/packages/ssplayer-core/wasm-nosimd"
echo "Copying no-SIMD runtime WASM (RPG Maker MZ / NW.js)..."
mkdir -p "$NOSIMD_OUT_DIR"
cp -r "$ROOT_DIR/SpriteStudio-SDK/pkg/runtime-web-nosimd/$MODE/"* "$NOSIMD_OUT_DIR/"

CONVERTER_OUT_DIR="$ROOT_DIR/packages/ssconverter-core/wasm"
echo "Copying generated converter WASM files..."
mkdir -p "$CONVERTER_OUT_DIR"
cp -r "$ROOT_DIR/SpriteStudio-SDK/pkg/converter-web/$MODE/"* "$CONVERTER_OUT_DIR/"

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
