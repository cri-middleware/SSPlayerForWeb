#!/usr/bin/env bash
#
# Install what the documentation site needs in order to build.
#
#   scripts/prepare-docs.sh            # pnpm install + the prebuilt SDK wasm
#   scripts/prepare-docs.sh wasm=build # compile the wasm from Rust instead
#
# Two things, because a fresh checkout has neither:
#
#   1. node_modules, from the lockfile.
#   2. The SDK wasm. It is not tracked in git, and the packages' sources import
#      it -- TypeDoc parses those sources to generate docs/api, so the docs build
#      needs the wasm on disk even though the site itself never loads it.
#
# Documentation only, in the sense that this is all the docs need: the other
# scripts here build and release the player. The -docs suffix keeps the two
# apart.
#
# Then: scripts/build-docs.sh, which runs TypeDoc and VitePress.
set -euo pipefail

APP="$(basename "$0")"
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

# --- options --------------------------------------------------------------
FROZEN="yes"
WASM="download"

usage () {
  echo "Usage: $APP [options]"
  echo "$APP options:"
  echo "  frozen=<yes|no>         Install with --frozen-lockfile, i.e. fail rather than"
  echo "                          update pnpm-lock.yaml (default: $FROZEN)"
  echo "  wasm=<download|build|no>"
  echo "                          Where the SDK wasm comes from (default: $WASM)."
  echo "                          download = the prebuilt binaries for SDK_VERSION.txt;"
  echo "                          build    = compile the Rust core here, which needs"
  echo "                                     rustup and wasm-pack;"
  echo "                          no       = leave whatever is already on disk."
  echo "  -h | --help             Show this help"
  echo ""
  echo "The wasm is not optional for a docs build: TypeDoc parses packages/*/src to"
  echo "generate docs/api, and those sources import the wasm bindings."
  echo ""
  echo "Building the site is scripts/build-docs.sh, not this script."
}

while [ $# -gt 0 ]; do
  item="$1"
  shift

  case "$item" in
    -h|--help|help)
      usage
      exit 0
      ;;
    *=*)
      key="${item%%=*}"
      value="$(printf '%s' "${item#*=}" | tr '[:upper:]' '[:lower:]')"
      case "$key" in
        frozen) FROZEN="$value" ;;
        wasm)   WASM="$value" ;;
        *)
          echo "$APP: unknown option '$key' (see $APP --help)" >&2
          exit 2
          ;;
      esac
      ;;
    *)
      echo "$APP: unknown argument '$item' (options are key=value; see $APP --help)" >&2
      exit 2
      ;;
  esac
done

case "$FROZEN" in
  yes|no) ;;
  *) echo "$APP: frozen must be yes or no (got '$FROZEN')" >&2; exit 2 ;;
esac

case "$WASM" in
  download|build|no) ;;
  *) echo "$APP: wasm must be download, build or no (got '$WASM')" >&2; exit 2 ;;
esac

echo "options"
echo "  frozen => $FROZEN"
echo "  wasm   => $WASM"
echo ""

# --- preflight ------------------------------------------------------------
if [ ! -f "$ROOT_DIR/docs/package.json" ]; then
  echo "$APP: docs/package.json not found -- is this the SSPlayerForWeb repo?" >&2
  exit 1
fi

if ! command -v pnpm > /dev/null 2>&1; then
  echo "$APP: pnpm not found (this repo pins it in package.json's packageManager)" >&2
  echo "$APP: enable it with 'corepack enable', or install it from https://pnpm.io" >&2
  exit 1
fi

# Every workspace path is relative to the repo root, so run from there however
# the script was invoked.
cd "$ROOT_DIR"

# --- install --------------------------------------------------------------
if [ "$FROZEN" = "yes" ]; then
  echo ">> pnpm install --frozen-lockfile"
  pnpm install --frozen-lockfile
else
  echo ">> pnpm install"
  pnpm install
fi

# --- wasm -----------------------------------------------------------------
case "$WASM" in
  download)
    echo ""
    echo ">> pnpm run download:wasm  (SDK $(tr -d '[:space:]' < scripts/SDK_VERSION.txt))"
    pnpm run download:wasm
    ;;
  build)
    echo ""
    echo ">> pnpm run build:wasm  (needs rustup + wasm-pack)"
    pnpm run build:wasm
    ;;
  no)
    echo ""
    echo "$APP: wasm=no -- using whatever is already under packages/*/wasm"
    ;;
esac

echo ""
echo "$APP: done"
echo "$APP: build the site:  scripts/build-docs.sh"
echo "$APP: live preview:    pnpm --filter=docs run dev"
