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
# The SDK publishes one combined archive, spritestudio-sdk-web-libs.zip, holding the
# three wasm-pack packages as subdirectories. Each is extracted into its target:
#   - runtime-web/         -> packages/ssplayer-core/wasm/
#   - runtime-web-nosimd/  -> packages/ssplayer-core/wasm-nosimd/
#   - converter-web/       -> packages/ssconverter-core/wasm/
# The no-SIMD runtime variant is consumed by ssplayer-rmmz (RPG Maker MZ / NW.js
# lacks WASM simd128).

HELP_APP="$(basename "$0")"
usage () {
    cat <<USAGE
Usage: ${HELP_APP} [--help]
  Install the SpriteStudio-SDK WASM release pinned by scripts/SDK_VERSION.txt into
  ssplayer-core/wasm, ssplayer-core/wasm-nosimd and ssconverter-core/wasm.
  Skips the download when that version is already in place.
USAGE
}

for arg in "$@"; do
  case "$arg" in
    -h|--help|help) usage; exit 0 ;;
    *) echo "${HELP_APP}: unknown argument '${arg}'" >&2; usage >&2; exit 2 ;;
  esac
done

BASEDIR=$(dirname "$0")
SCRIPTDIR=$(cd "$BASEDIR" && pwd -P)
ROOTDIR=$(cd "$BASEDIR/.." && pwd -P)
VERSION_FILE="${SCRIPTDIR}/SDK_VERSION.txt"

REPO="cri-middleware/SpriteStudio-SDK"
RUNTIME_DIR="${ROOTDIR}/packages/ssplayer-core/wasm"
RUNTIME_NOSIMD_DIR="${ROOTDIR}/packages/ssplayer-core/wasm-nosimd"
CONVERTER_DIR="${ROOTDIR}/packages/ssconverter-core/wasm"
VERSION_MARKER="${RUNTIME_DIR}/VERSION"
# Downloaded zip is cached here (gitignored) so a re-run that needs the same
# version reuses it instead of re-downloading.
CACHE_DIR="${SCRIPTDIR}/.sdk-cache"

TARGET_VERSION=$(tr -d '\r\n' < "$VERSION_FILE")

if [ -f "$VERSION_MARKER" ]; then
    CURRENT_VERSION=$(tr -d '\r\n' < "$VERSION_MARKER")
    if [ "$CURRENT_VERSION" = "$TARGET_VERSION" ]; then
        echo "SDK WASM $TARGET_VERSION is already up to date. Skipping download."
        exit 0
    fi
fi

BASE_URL="https://github.com/${REPO}/releases/download/${TARGET_VERSION}"
# Keep the release asset's own name so it matches the SHA256SUMS entry directly.
WEB_ASSET="spritestudio-sdk-web-libs.zip"
WEB_ZIP="${CACHE_DIR}/${WEB_ASSET}"
SUMS_FILE="${CACHE_DIR}/SHA256SUMS"

echo "Target SDK Version: ${TARGET_VERSION}"
mkdir -p "$CACHE_DIR"

sha256_of() {
    if command -v sha256sum >/dev/null 2>&1; then
        sha256sum "$1" | awk '{print $1}'
    else
        shasum -a 256 "$1" | awk '{print $1}'
    fi
}

# Fetch the checksum manifest (small): it both verifies integrity and decides
# whether an already-cached zip can be reused without re-downloading.
echo "Downloading checksum manifest:   ${BASE_URL}/SHA256SUMS"
curl -fL -o "$SUMS_FILE" "${BASE_URL}/SHA256SUMS"

# ensure_asset <asset-name>: leave a checksum-verified copy of the asset in the
# cache under its own name, reusing an already-matching one instead of
# re-downloading.
ensure_asset() {
    local asset="$1" file="${CACHE_DIR}/$1" expected
    expected=$(awk -v n="$asset" '$2 == n {print $1}' "$SUMS_FILE")
    if [ -z "$expected" ]; then
        echo "ERROR: no checksum entry for ${asset} in SHA256SUMS" >&2
        exit 1
    fi
    if [ -f "$file" ] && [ "$(sha256_of "$file")" = "$expected" ]; then
        echo "Reusing cached ${asset}"
    else
        echo "Downloading ${BASE_URL}/${asset}"
        curl -fL -o "$file" "${BASE_URL}/${asset}"
        if [ "$(sha256_of "$file")" != "$expected" ]; then
            echo "ERROR: checksum mismatch for ${asset}" >&2
            rm -f "$file"
            exit 1
        fi
    fi
    echo "Checksum OK: ${asset}"
}

ensure_asset "$WEB_ASSET"

# The archive holds runtime-web/, runtime-web-nosimd/ and converter-web/ as
# subdirectories. Extract each into its target with -j so the subdir prefix is
# stripped and files land flat (as the packages expect). 'runtime-web/*' does
# not match 'runtime-web-nosimd/*' — the literal prefixes differ.
echo "Extracting runtime WASM          -> ${RUNTIME_DIR}"
mkdir -p "$RUNTIME_DIR"
unzip -q -o -j "$WEB_ZIP" 'runtime-web/*' -d "$RUNTIME_DIR"

echo "Extracting runtime WASM (nosimd) -> ${RUNTIME_NOSIMD_DIR}"
mkdir -p "$RUNTIME_NOSIMD_DIR"
unzip -q -o -j "$WEB_ZIP" 'runtime-web-nosimd/*' -d "$RUNTIME_NOSIMD_DIR"

echo "Extracting converter WASM        -> ${CONVERTER_DIR}"
mkdir -p "$CONVERTER_DIR"
unzip -q -o -j "$WEB_ZIP" 'converter-web/*' -d "$CONVERTER_DIR"

echo "$TARGET_VERSION" > "$VERSION_MARKER"

echo "Done."
