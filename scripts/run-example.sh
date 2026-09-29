#!/usr/bin/env bash
#
# Take a fresh checkout to a running example.
#
#   scripts/run-example.sh                     # examples/webgl-example: the <ss-player> demos
#   scripts/run-example.sh example=pixi        # or override, part-follow, sspj-preview
#
# Also `pnpm run example`. example=<webgl|pixi|override|part-follow|sspj-preview>, webgl by
# default. In order, each step only when its output is missing:
#
#   1. checks out the SpriteStudio-SDK submodule
#   2. pnpm install
#   3. the WASM: pnpm run download:wasm; while the SDK has published no release for it to
#      download, builds it from source (pnpm run build:wasm, which needs Rust and wasm-pack)
#   4. pnpm run build, the packages the examples consume
#   5. the example's assets (pnpm run deploy-examples)
#   6. starts the example's dev server and opens it (Ctrl-C stops it)
#
# Nothing checks whether an existing output is stale: after changing TypeScript under
# packages/, run pnpm run build yourself, and after changing Rust, pnpm run build:wasm.
set -euo pipefail

APP="$(basename "$0")"
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

EXAMPLE="webgl"
for arg in "$@"; do
  case "$arg" in
    example=*) EXAMPLE="${arg#example=}" ;;
    -h|--help) sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "$APP: unknown argument '$arg' (see $APP --help)" >&2; exit 2 ;;
  esac
done

case "$EXAMPLE" in
  webgl|pixi|override) DIR="$EXAMPLE-example" ;;
  part-follow|sspj-preview) DIR="$EXAMPLE" ;;
  *) echo "$APP: example must be webgl, pixi, override, part-follow or sspj-preview (got '$EXAMPLE')" >&2; exit 2 ;;
esac

cd "$ROOT_DIR"

# --- 1. the SDK -----------------------------------------------------------
if [ ! -f SpriteStudio-SDK/tests/Ringo/Ringo.sspj ]; then
  echo ">> $APP: checking out the SpriteStudio-SDK submodule"
  git submodule update --init --recursive
fi

# --- 2. dependencies ------------------------------------------------------
if [ ! -d node_modules ]; then
  echo ">> $APP: pnpm install"
  pnpm install
fi

# --- 3. the WASM ----------------------------------------------------------
if [ ! -f packages/ssplayer-core/wasm/ssruntime_bg.wasm ] || [ ! -f packages/ssconverter-core/wasm/ssconverter_bg.wasm ]; then
  echo ">> $APP: pnpm run download:wasm"
  if ! pnpm run download:wasm; then
    command -v cargo > /dev/null 2>&1 && command -v wasm-pack > /dev/null 2>&1 || {
      echo "$APP: there is no SDK release to download the WASM from yet, and building it needs Rust (https://rustup.rs) and wasm-pack (cargo install wasm-pack)" >&2
      exit 1
    }
    echo ">> $APP: no release to download from; building the WASM from source (pnpm run build:wasm)"
    pnpm run build:wasm
  fi
fi

# --- 4. the packages ------------------------------------------------------
if [ ! -f packages/ssplayer-core/dist/index.js ] || [ ! -f packages/ssconverter-core/dist/index.js ] \
  || [ ! -f packages/ssplayer-webgl/dist/index.js ] || [ ! -f packages/ssplayer-pixi/dist/index.js ]; then
  echo ">> $APP: pnpm run build"
  pnpm run build
fi

# --- 5. the assets --------------------------------------------------------
if [ ! -f "examples/$DIR/public/Ringo/Ringo.ssab" ]; then
  echo ">> $APP: converting the SDK's test projects (pnpm run deploy-examples)"
  pnpm run deploy-examples
fi

# --- 6. the example -------------------------------------------------------
echo ">> $APP: starting examples/$DIR (Ctrl-C to stop)"
exec pnpm --filter "./examples/$DIR" run dev --open
