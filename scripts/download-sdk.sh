#!/bin/bash
set -e

# Fetch the pre-built WASM from the SpriteStudio-SDK GitHub Releases instead of
# building it from source. This lets you run the examples without a Rust /
# wasm-pack toolchain (`pnpm run build:wasm` remains the from-source path).
#
# NOTE (provisional): the SpriteStudio-SDK does not publish WASM release assets
# yet. Until a release is available, this script will fail at the download step
# — build from source with `pnpm run build:wasm` in the meantime.
#
# Asset names and layout follow SpriteStudio-SDK/.github/workflows/release.yml:
#   - spritestudio-sdk-runtime-web.zip         -> packages/ssplayer-core/wasm/
#   - spritestudio-sdk-runtime-web-nosimd.zip  -> packages/ssplayer-core/wasm-nosimd/
#   - spritestudio-sdk-converter-web.zip       -> packages/ssconverter-core/wasm/
# Both zips are flattened (`zip -rj`), so their files extract directly into the
# target directory. The no-SIMD runtime variant is consumed by ssplayer-rmmz
# (RPG Maker MZ / NW.js lacks WASM simd128).

BASEDIR=$(dirname "$0")
ROOTDIR=$(cd "$BASEDIR/.." && pwd -P)
VERSION_FILE="${ROOTDIR}/SDK_VERSION.txt"

REPO="cri-middleware/SpriteStudio-SDK"
RUNTIME_DIR="${ROOTDIR}/packages/ssplayer-core/wasm"
RUNTIME_NOSIMD_DIR="${ROOTDIR}/packages/ssplayer-core/wasm-nosimd"
CONVERTER_DIR="${ROOTDIR}/packages/ssconverter-core/wasm"
VERSION_MARKER="${RUNTIME_DIR}/VERSION"

TARGET_VERSION=$(tr -d '\r\n' < "$VERSION_FILE")

if [ -f "$VERSION_MARKER" ]; then
    CURRENT_VERSION=$(tr -d '\r\n' < "$VERSION_MARKER")
    if [ "$CURRENT_VERSION" = "$TARGET_VERSION" ]; then
        echo "SDK WASM $TARGET_VERSION is already up to date. Skipping download."
        exit 0
    fi
fi

BASE_URL="https://github.com/${REPO}/releases/download/${TARGET_VERSION}"
RUNTIME_ZIP_URL="${BASE_URL}/spritestudio-sdk-runtime-web.zip"
RUNTIME_NOSIMD_ZIP_URL="${BASE_URL}/spritestudio-sdk-runtime-web-nosimd.zip"
CONVERTER_ZIP_URL="${BASE_URL}/spritestudio-sdk-converter-web.zip"

TMP_DIR=$(mktemp -d)
trap 'rm -rf "$TMP_DIR"' EXIT

echo "Target SDK Version: ${TARGET_VERSION}"

echo "Downloading runtime WASM:        ${RUNTIME_ZIP_URL}"
curl -fL -o "${TMP_DIR}/runtime-web.zip" "$RUNTIME_ZIP_URL"

echo "Downloading runtime WASM (nosimd): ${RUNTIME_NOSIMD_ZIP_URL}"
curl -fL -o "${TMP_DIR}/runtime-web-nosimd.zip" "$RUNTIME_NOSIMD_ZIP_URL"

echo "Downloading converter WASM:      ${CONVERTER_ZIP_URL}"
curl -fL -o "${TMP_DIR}/converter-web.zip" "$CONVERTER_ZIP_URL"

echo "Extracting runtime WASM          -> ${RUNTIME_DIR}"
mkdir -p "$RUNTIME_DIR"
unzip -q -o "${TMP_DIR}/runtime-web.zip" -d "$RUNTIME_DIR"

echo "Extracting runtime WASM (nosimd) -> ${RUNTIME_NOSIMD_DIR}"
mkdir -p "$RUNTIME_NOSIMD_DIR"
unzip -q -o "${TMP_DIR}/runtime-web-nosimd.zip" -d "$RUNTIME_NOSIMD_DIR"

echo "Extracting converter WASM        -> ${CONVERTER_DIR}"
mkdir -p "$CONVERTER_DIR"
unzip -q -o "${TMP_DIR}/converter-web.zip" -d "$CONVERTER_DIR"

echo "$TARGET_VERSION" > "$VERSION_MARKER"

echo "Done."
