#!/usr/bin/env bash
#
# Build the whole GitHub Pages site into one directory: the docs (VitePress) at
# the root, ssconverter-web (every schema version in versions.json) under
# /ssconverter/, and the six examples -- pixi, webgl, override, sspj-preview,
# the static RPG Maker MZ SampleProject (rmmz) and the static TyranoScript
# project -- under /examples/.
#
#   scripts/build-pages.sh                            # -> _site, base /<repo>/
#   scripts/build-pages.sh base=/ out=/tmp/site       # a site served from a root
#   scripts/build-pages.sh sdk=build                  # compile the wasm instead
#   scripts/build-pages.sh skip=install,wasm,ssconverter api=no   # iterate fast
#
# pages.yml runs this script for the site it uploads, so CI and a local build
# cannot drift. The workflow keeps only what is GitHub's -- the checkout (SDK
# submodule + full history), the pnpm/Node toolchain, the artifact upload and
# the deploy; everything that produces a file lives here.
#
# The whole site is rebuilt every run, which is what the artifact deploy does
# anyway (it replaces the site wholesale, so past ssconverter versions only stay
# up by being rebuilt). skip= trades that away for speed while iterating.
#
# One run at a time per worktree, whichever twin: the stages write through
# packages/*/dist, packages/*/wasm and the example projects, so a second run
# deletes what the first is reading. It shows up as an unrelated-looking failure
# -- a sync:plugin that cannot find main.js, a wasm copy whose source vanished.
#
# What this needs that a plain `pnpm install` does not: the SpriteStudio-SDK
# submodule (deploy-examples compiles its tests/*.sspj, and sdk=build compiles
# its Rust runtime), `jq` (the ssconverter loop reads versions.json), and
# network access (the SDK wasm per converter version, and the TyranoScript
# engine).
set -euo pipefail

APP="$(basename "$0")"
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

# Stages, in the order they run. `assemble` is not one of them: it is cheap and
# copies whatever the stages produced, so there is nothing to skip.
STAGES="install wasm packages assets rmmz tyranoscript docs examples ssconverter"

# --- options --------------------------------------------------------------

# A project site is served under /<repo>/. The workflow passes
# github.event.repository.name; here the origin remote names the repository,
# falling back to the clone's directory name.
default_base () {
  local url name
  url="$(git -C "$ROOT_DIR" config --get remote.origin.url 2>/dev/null || true)"
  name="${url##*/}"
  name="${name%.git}"
  [ -n "$name" ] || name="$(basename "$ROOT_DIR")"
  printf '/%s/' "$name"
}

BASE="$(default_base)"
OUT="_site"
API="yes"
SDK="download"
SKIP=""
CLEAN=""   # resolved after parsing: yes when nothing is skipped, no otherwise

usage () {
  echo "Usage: $APP [options]"
  echo "$APP options:"
  echo "  base=<path>             Public base path (default: $BASE -- this clone's"
  echo "                          repository name, which is what a project site is"
  echo "                          served under). Must start and end with '/'. base=/"
  echo "                          builds a site you can serve from a document root."
  echo "  out=<dir>               Where to assemble the site (default: $OUT)."
  echo "                          Relative paths resolve against the current directory."
  echo "  api=<yes|no>            Regenerate the API reference with TypeDoc (default:"
  echo "                          $API). api=no is passed straight to build-docs.sh."
  echo "  sdk=<download|build>    Where the SDK wasm comes from (default: $SDK)."
  echo "                          download = download-sdk.sh, the pre-built release"
  echo "                          for scripts/SDK_VERSION.txt. build ="
  echo "                          build-runtime.sh, compiled from the Rust source in"
  echo "                          the submodule (release mode; needs rustup +"
  echo "                          wasm-pack) -- what to use when the SDK release the"
  echo "                          version file names does not exist yet."
  echo "  skip=<a,b,...>          Stages to leave out. One or more of:"
  echo "                          $STAGES"
  echo "  clean=<yes|no>          Delete <out> before building (default: yes, or no"
  echo "                          when skip= is given, so a partial run keeps the"
  echo "                          pieces an earlier run produced)."
  echo "  -h | --help             Show this help"
  echo ""
  echo "Stages:"
  echo "  install       pnpm install --frozen-lockfile"
  echo "  wasm          the SDK runtime + converter wasm (not in git), per sdk="
  echo "  packages      pnpm run build (every package except docs)"
  echo "  assets        deploy-examples -- compile the SDK test projects to .ssab"
  echo "  rmmz          sync the built plugin + wasm into rmmz-example"
  echo "  tyranoscript  fetch the TyranoScript engine, then sync the plugin + wasm"
  echo "  docs          build-docs.sh (TypeDoc, then VitePress)"
  echo "  examples      vite build for pixi-example, webgl-example, override-example, sspj-preview"
  echo "  ssconverter   build-ssconverter-pages.sh -- every schema version"
  echo ""
  echo "A skipped stage leaves its part out of the site (a warning says which);"
  echo "a stage that ran but produced nothing is an error."
  echo ""
  echo "sdk=build reaches the ssconverter stage too, but only as far as one schema"
  echo "version: the one whose sdk tag in versions.json matches SDK_VERSION.txt gets"
  echo "the wasm just built, and every other version is still downloaded from the"
  echo "release it pins -- which is the point of pinning it, and which no local build"
  echo "can stand in for. Each version says out loud which of the two it took."
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
      value="${item#*=}"
      case "$key" in
        base)  BASE="$value" ;;
        out)   OUT="$value" ;;
        # Lower-cased, because these are keywords rather than paths.
        api)   API="$(printf '%s' "$value" | tr '[:upper:]' '[:lower:]')" ;;
        sdk)   SDK="$(printf '%s' "$value" | tr '[:upper:]' '[:lower:]')" ;;
        clean) CLEAN="$(printf '%s' "$value" | tr '[:upper:]' '[:lower:]')" ;;
        skip)  SKIP="$(printf '%s' "$value" | tr ',' ' ')" ;;
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

case "$API" in
  yes|no) ;;
  *) echo "$APP: api must be yes or no (got '$API')" >&2; exit 2 ;;
esac

case "$SDK" in
  download|build) ;;
  *) echo "$APP: sdk must be download or build (got '$SDK')" >&2; exit 2 ;;
esac

# A base that does not start and end with / silently produces a site whose every
# asset URL is wrong, and nothing downstream notices until it is deployed.
case "$BASE" in
  /*/|/) ;;
  *) echo "$APP: base must start and end with '/' (got '$BASE')" >&2; exit 2 ;;
esac

for name in $SKIP; do
  case " $STAGES " in
    *" $name "*) ;;
    *) echo "$APP: unknown stage '$name' in skip= (stages: $STAGES)" >&2; exit 2 ;;
  esac
done

if [ -z "$CLEAN" ]; then
  if [ -n "$SKIP" ]; then CLEAN="no"; else CLEAN="yes"; fi
fi
case "$CLEAN" in
  yes|no) ;;
  *) echo "$APP: clean must be yes or no (got '$CLEAN')" >&2; exit 2 ;;
esac

# Resolve out= against the invoking directory, before anything cds away from it.
case "$OUT" in
  /*) ;;
  *)  OUT="$PWD/$OUT" ;;
esac
# clean=yes deletes this path, so refuse the two that would take the repository
# (or the filesystem) with them.
if [ "$OUT" = "/" ] || [ "$OUT" = "$ROOT_DIR" ]; then
  echo "$APP: refusing to use '$OUT' as out= (it is deleted when clean=yes)" >&2
  exit 2
fi

skipping () {
  case " $SKIP " in
    *" $1 "*) return 0 ;;
  esac
  return 1
}

# stage <name> <what it does> -- true when the stage should run.
stage () {
  local name="$1"
  shift
  echo ""
  if skipping "$name"; then
    echo ">> [$name] skipped"
    return 1
  fi
  echo ">> [$name] $*"
  return 0
}

echo "options"
echo "  base  => $BASE"
echo "  out   => $OUT"
echo "  api   => $API"
echo "  sdk   => $SDK"
echo "  skip  => ${SKIP:-(nothing)}"
echo "  clean => $CLEAN"

# --- preflight ------------------------------------------------------------
if [ ! -f "$ROOT_DIR/pnpm-workspace.yaml" ]; then
  echo "$APP: pnpm-workspace.yaml not found -- is this the SSPlayerForWeb repo?" >&2
  exit 1
fi

if ! command -v pnpm > /dev/null 2>&1; then
  echo "$APP: pnpm not found (this repo pins it in package.json's packageManager)" >&2
  echo "$APP: enable it with 'corepack enable', or install it from https://pnpm.io" >&2
  exit 1
fi

# deploy-examples compiles SpriteStudio-SDK/tests/*.sspj, which only exist once
# the submodule is checked out. download:wasm is no substitute -- it brings the
# wasm, not the test projects.
if ! skipping assets && [ ! -d "$ROOT_DIR/SpriteStudio-SDK/tests" ]; then
  echo "$APP: SpriteStudio-SDK/tests is missing -- the submodule is not checked out" >&2
  echo "$APP: fix it with 'git submodule update --init --recursive'" >&2
  exit 1
fi

# sdk=build compiles the Rust runtime in that same submodule. (wasm-pack itself
# is not checked for here: SpriteStudio-SDK/scripts/release-web.sh already does
# it, and it also accepts one that only lives in ~/.cargo/bin.)
if [ "$SDK" = "build" ] && ! skipping wasm && [ ! -d "$ROOT_DIR/SpriteStudio-SDK/libs/ssruntime" ]; then
  echo "$APP: sdk=build needs SpriteStudio-SDK/libs/ssruntime -- the submodule is not checked out" >&2
  echo "$APP: fix it with 'git submodule update --init --recursive'" >&2
  exit 1
fi

if ! skipping ssconverter; then
  if ! command -v jq > /dev/null 2>&1; then
    echo "$APP: jq not found -- build-ssconverter-pages.sh reads versions.json with it" >&2
    exit 1
  fi
  # A version pinned to a git ref is built in a worktree, which a shallow clone
  # cannot check out. CI passes fetch-depth: 0 for exactly this.
  if [ "$(jq -r '[.versions[] | select(.ref)] | length' "$ROOT_DIR/packages/ssconverter-web/versions.json")" != "0" ] \
     && [ "$(git -C "$ROOT_DIR" rev-parse --is-shallow-repository 2>/dev/null || echo false)" = "true" ]; then
    echo "$APP: versions.json pins a version to a git ref, but this is a shallow clone" >&2
    echo "$APP: fix it with 'git fetch --unshallow --tags'" >&2
    exit 1
  fi
fi

# Every workspace path is relative to the repo root, so build from there however
# the script was invoked.
cd "$ROOT_DIR"

# --- build ----------------------------------------------------------------
if [ "$CLEAN" = "yes" ]; then
  rm -rf "$OUT"
fi
mkdir -p "$OUT"

if stage install "install workspace dependencies"; then
  pnpm install --frozen-lockfile
fi

# wasm is not tracked in git, and the packages and the examples cannot be built
# without it. sdk=download takes the pre-built release for the version in
# scripts/SDK_VERSION.txt; sdk=build compiles it from the Rust source in the
# submodule, in release mode -- a debug wasm has no business in a published
# site, and this is the way out when the release the version file names does not
# exist yet. Either way the runtime, its no-SIMD variant and the converter all
# land in packages/*/wasm.
#
# (The ssconverter stage takes its converter wasm per schema version, from the
# sdk tag versions.json pins. sdk=build reaches the one version whose tag is the
# one built here; the rest still download.)
if [ "$SDK" = "build" ]; then
  wasm_what="build the SDK wasm from source (runtime + converter, release)"
else
  wasm_what="download the SDK wasm (runtime + converter)"
fi
if stage wasm "$wasm_what"; then
  if [ "$SDK" = "build" ]; then
    ./scripts/build-runtime.sh build=release
  else
    pnpm run download:wasm
  fi
fi

if stage packages "build the packages"; then
  pnpm run build
fi

# Generate the .ssab assets the examples load, from the SpriteStudio-SDK test
# projects.
if stage assets "generate the example assets"; then
  pnpm run deploy-examples
fi

# rmmz-example is a static RPG Maker MZ project (no bundler): sync the built
# plugin + no-SIMD runtime wasm into its js/plugins/. The assets stage already
# produced the .ssab under SampleProject/spritestudio/.
if stage rmmz "sync the rmmz-example plugin"; then
  pnpm --filter rmmz-example run sync:plugin
fi

# tyranoscript-example is a static TyranoScript project. Fetch the (git-ignored)
# engine -- index.html + tyrano/ + data/system/, pinned by TYRANO_VERSION.txt --
# then sync the built plugin + runtime wasm into its plugin folder. The assets
# stage already placed the Ringo .ssab under data/others/ssdata/.
if stage tyranoscript "fetch the TyranoScript engine, sync the plugin"; then
  pnpm --filter tyranoscript-example run fetch:engine
  pnpm --filter tyranoscript-example run sync:plugin
fi

# docs (VitePress): build-docs.sh is what a contributor runs, so the docs build
# stays spelled out in one place -- TypeDoc, then VitePress, with base passed
# through as DOCS_BASE (config.mts reads it).
#
# Its companion scripts/prepare-docs.sh is deliberately not used: it is
# `pnpm install` + `download:wasm`, which the stages above already ran for the
# packages, the examples and the converter -- not for the docs alone.
if stage docs "build the docs"; then
  ./scripts/build-docs.sh base="$BASE" api="$API"
fi

# examples: base is injected via vite's --base CLI (the configs stay untouched).
if stage examples "build the vite examples"; then
  pnpm --filter=pixi-example exec vite build --base="${BASE}examples/pixi/"
  pnpm --filter=webgl-example exec vite build --base="${BASE}examples/webgl/"
  pnpm --filter=override-example exec vite build --base="${BASE}examples/override/"
  pnpm --filter=sspj-preview exec vite build --base="${BASE}examples/sspj-preview/"
fi

# ssconverter-web: every schema version from versions.json, into
# <out>/ssconverter/<schema>/. It writes into <out> itself, so it runs before
# assemble rather than through it.
if stage ssconverter "build ssconverter-web (all schema versions)"; then
  SITE_BASE="$BASE" SDK_WASM="$SDK" bash scripts/build-ssconverter-pages.sh "$OUT"
fi

# --- assemble -------------------------------------------------------------
echo ""
echo ">> [assemble] collect the site into $OUT"

# copy_tree <label> <src-dir> <dest-dir> <required:yes|no>
copy_tree () {
  local label="$1" src="$2" dest="$3" required="$4"
  if [ ! -d "$src" ]; then
    if [ "$required" = "yes" ]; then
      echo "$APP: $label: $src is missing though its stage ran" >&2
      exit 1
    fi
    echo "   $label: skipped (no $src)"
    return 0
  fi
  rm -rf "$dest"
  mkdir -p "$dest"
  cp -R "$src/." "$dest/"
  echo "   $label -> ${dest#"$OUT"/}"
}

# add_demo_links <dir> <path from its pages to the site root>
# Puts a fixed "Powered by" box, linking to the docs and the repository, into
# every *.html directly in <dir>, ahead of the last </body>.
add_demo_links () {
  local dir="$1" root="$2" page
  [ -d "$dir" ] || return 0
  local a='target="_blank" rel="noopener" style="color:#fff"'
  local links='<div id="ss-demo-links" style="position:fixed;left:12px;bottom:12px;z-index:2147483647;padding:4px 10px;border-radius:6px;background:rgba(0,0,0,.65);color:#fff;font:12px/1.6 system-ui,sans-serif">'
  links+="Powered by SpriteStudio Player for Web &middot; <a href=\"$root\" $a>Docs</a>"
  links+=" &middot; <a href=\"https://github.com/cri-middleware/SSPlayerForWeb\" $a>GitHub</a></div>"
  for page in "$dir"/*.html; do
    [ -f "$page" ] || continue
    grep -q 'id="ss-demo-links"' "$page" && continue
    awk -v links="$links" '
      { line[NR] = $0 }
      END {
        for (at = NR; at > 0; at--) if (tolower(line[at]) ~ /<\/body>/) break
        for (i = 1; i <= NR; i++) {
          if (i != at) { print line[i]; continue }
          lc = tolower(line[i]); j = 0
          while ((k = index(substr(lc, j + 1), "</body>")) > 0) j += k
          print substr(line[i], 1, j - 1) links substr(line[i], j)
        }
        if (at == 0) print links
      }' "$page" > "$page.tmp"
    mv "$page.tmp" "$page"
  done
  echo "   links to the docs and the repository -> ${dir#"$OUT"/}/*.html"
}

# The docs own the site root, so this one copy cannot wipe its destination --
# ssconverter/ and examples/ live under it.
if [ -d docs/.vitepress/dist ]; then
  cp -R docs/.vitepress/dist/. "$OUT/"
  echo "   docs -> (site root)"
elif skipping docs; then
  echo "   docs: skipped (no docs/.vitepress/dist)"
else
  echo "$APP: docs/.vitepress/dist is missing though the docs stage ran" >&2
  exit 1
fi

if skipping examples; then req="no"; else req="yes"; fi
copy_tree "pixi-example"     examples/pixi-example/dist     "$OUT/examples/pixi"     "$req"
copy_tree "webgl-example"    examples/webgl-example/dist    "$OUT/examples/webgl"    "$req"
copy_tree "override-example" examples/override-example/dist "$OUT/examples/override" "$req"
copy_tree "sspj-preview"     examples/sspj-preview/dist     "$OUT/examples/sspj-preview" "$req"

# rmmz-example: the static MZ project is copied as it is -- its paths are
# relative, so it runs under the /examples/rmmz/ subpath with no base rewrite.
copy_tree "rmmz-example" examples/rmmz-example/SampleProject "$OUT/examples/rmmz" yes

# tyranoscript-example: engine + data, relative paths, likewise copied as it is.
# Only the three paths the engine and the game need -- not scripts/ or the README.
TYRANO_SRC="examples/tyranoscript-example"
if [ -f "$TYRANO_SRC/index.html" ] && [ -d "$TYRANO_SRC/tyrano" ]; then
  rm -rf "$OUT/examples/tyranoscript"
  mkdir -p "$OUT/examples/tyranoscript"
  cp -R "$TYRANO_SRC/index.html" "$TYRANO_SRC/tyrano" "$TYRANO_SRC/data" "$OUT/examples/tyranoscript/"
  echo "   tyranoscript-example -> examples/tyranoscript"
elif skipping tyranoscript; then
  echo "   tyranoscript-example: skipped (engine not fetched)"
else
  echo "$APP: $TYRANO_SRC has no engine though the tyranoscript stage ran" >&2
  exit 1
fi

for demo in pixi webgl override sspj-preview rmmz tyranoscript; do
  add_demo_links "$OUT/examples/$demo" "../../"
done

# --- done -----------------------------------------------------------------
echo ""
echo "$APP: done -> $OUT  (base $BASE)"
if [ -n "$SKIP" ]; then
  echo "$APP: partial site -- stages skipped: $SKIP"
fi
# --bind, and localhost in the URL, are not decoration: ssconverter-web reads
# the project folder through the File System Access API, which exists only in a
# secure context -- over plain http that means localhost / 127.0.0.1 / [::1] and
# nothing else. Served on the default bind, `python3 -m http.server` advertises
# itself as http://0.0.0.0:8080/ (or http://[::]:8080/), and a site opened at
# that URL cannot pick a folder at all.
if [ "$BASE" = "/" ]; then
  echo "$APP: preview it:"
  echo "  python3 -m http.server 8080 --bind 127.0.0.1 --directory \"$OUT\""
  echo "  open http://localhost:8080/"
else
  # Every asset URL starts with $BASE, so serving $OUT itself 404s. Hang it off
  # a scratch root under the base path instead.
  PREVIEW_LINK=".pages-preview${BASE%/}"
  echo "$APP: built for $BASE, so serving $OUT directly 404s on its assets."
  echo "$APP: preview it:"
  echo "  mkdir -p \"$(dirname "$PREVIEW_LINK")\" && ln -sfn \"$OUT\" \"$PREVIEW_LINK\""
  echo "  python3 -m http.server 8080 --bind 127.0.0.1 --directory .pages-preview"
  echo "  open http://localhost:8080$BASE"
  echo "$APP: open it as localhost, not as the http://[::]:8080/ the server prints:"
  echo "$APP: ssconverter-web needs a secure context to read a project folder."
fi
