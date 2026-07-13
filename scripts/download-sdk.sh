#!/bin/bash
set -e

# Fetch the pre-built WASM from the SpriteStudio-SDK GitHub Releases instead of
# building it from source. This lets you run the examples without a Rust /
# wasm-pack toolchain (`pnpm run build:wasm` remains the from-source path).
#
# NOTE (provisional): until a SpriteStudio-SDK release that publishes the WASM
# assets is available, this script fails at the download step — build from
# source with `pnpm run build:wasm` in the meantime.
#
# Asset names and layout follow SpriteStudio-SDK/.github/workflows/release.yml:
#   - spritestudio-sdk-runtime-web.zip         -> packages/ssplayer-core/wasm/
#   - spritestudio-sdk-runtime-web-nosimd.zip  -> packages/ssplayer-core/wasm-nosimd/
#   - spritestudio-sdk-converter-web.zip       -> packages/ssconverter-core/wasm/
# Both zips are flattened (`zip -rj`), so their files extract directly into the
# target directory. The no-SIMD runtime variant is consumed by ssplayer-rmmz
# (RPG Maker MZ / NW.js lacks WASM simd128).

BASEDIR=$(dirname "$0")
SCRIPTDIR=$(cd "$BASEDIR" && pwd -P)
ROOTDIR=$(cd "$BASEDIR/.." && pwd -P)
VERSION_FILE="${SCRIPTDIR}/SDK_VERSION.txt"

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
RUNTIME_ASSET="spritestudio-sdk-runtime-web.zip"
RUNTIME_NOSIMD_ASSET="spritestudio-sdk-runtime-web-nosimd.zip"
CONVERTER_ASSET="spritestudio-sdk-converter-web.zip"

TMP_DIR=$(mktemp -d)
trap 'rm -rf "$TMP_DIR"' EXIT
SUMS_FILE="${TMP_DIR}/SHA256SUMS"

echo "Target SDK Version: ${TARGET_VERSION}"

# Verify <file> against the release's SHA256SUMS manifest entry for <asset-name>
# before extracting, so a corrupted or tampered download fails loudly. Uses
# sha256sum (Linux) or shasum -a 256 (macOS); matches the entry by asset name.
verify_sha256() {
    local file="$1" name="$2" expected actual
    expected=$(awk -v n="$name" '$2 == n {print $1}' "$SUMS_FILE")
    if [ -z "$expected" ]; then
        echo "ERROR: no checksum entry for ${name} in SHA256SUMS" >&2
        exit 1
    fi
    if command -v sha256sum >/dev/null 2>&1; then
        actual=$(sha256sum "$file" | awk '{print $1}')
    else
        actual=$(shasum -a 256 "$file" | awk '{print $1}')
    fi
    if [ "$expected" != "$actual" ]; then
        echo "ERROR: checksum mismatch for ${name}" >&2
        echo "  expected: ${expected}" >&2
        echo "  actual:   ${actual}" >&2
        exit 1
    fi
    echo "Checksum OK: ${name}"
}

echo "Downloading checksum manifest:   ${BASE_URL}/SHA256SUMS"
curl -fL -o "$SUMS_FILE" "${BASE_URL}/SHA256SUMS"

for asset in "$RUNTIME_ASSET" "$RUNTIME_NOSIMD_ASSET" "$CONVERTER_ASSET"; do
    echo "Downloading ${BASE_URL}/${asset}"
    curl -fL -o "${TMP_DIR}/${asset}" "${BASE_URL}/${asset}"
    verify_sha256 "${TMP_DIR}/${asset}" "$asset"
done

echo "Extracting runtime WASM          -> ${RUNTIME_DIR}"
mkdir -p "$RUNTIME_DIR"
unzip -q -o "${TMP_DIR}/${RUNTIME_ASSET}" -d "$RUNTIME_DIR"

echo "Extracting runtime WASM (nosimd) -> ${RUNTIME_NOSIMD_DIR}"
mkdir -p "$RUNTIME_NOSIMD_DIR"
unzip -q -o "${TMP_DIR}/${RUNTIME_NOSIMD_ASSET}" -d "$RUNTIME_NOSIMD_DIR"

echo "Extracting converter WASM        -> ${CONVERTER_DIR}"
mkdir -p "$CONVERTER_DIR"
unzip -q -o "${TMP_DIR}/${CONVERTER_ASSET}" -d "$CONVERTER_DIR"

echo "$TARGET_VERSION" > "$VERSION_MARKER"

echo "Done."
