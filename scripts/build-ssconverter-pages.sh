#!/bin/bash
# Build every ssab-schema version of ssconverter-web listed in
# packages/ssconverter-web/versions.json and stage them under
# <OUT>/ssconverter/<schema>/ for a GitHub Pages deploy.
#
# Strategy: rebuild-all. The artifact-based Pages deploy replaces the whole site
# on every run, so keeping past versions means rebuilding all of them each time.
# Each version's converter wasm is not tracked in git, so it is fetched on demand
# from the SpriteStudio-SDK Releases for that version's sdk tag in versions.json.
#
# App source per version:
#   - No "ref" field  -> built from the current working tree (the common case;
#     fine while the wasm JS interface stays stable across schema versions).
#   - "ref" field set -> that version is built from the pinned git ref (tag /
#     branch / commit) in an isolated worktree, so a past version keeps building
#     against the app source it shipped with even if the wasm interface changes.
#     Requires full history in CI (actions/checkout with fetch-depth: 0).
#
# Usage:  SITE_BASE=/SSPlayerForWeb/ scripts/build-ssconverter-pages.sh <out-dir>
#   SITE_BASE : Pages base path (with leading/trailing slash), e.g. /SSPlayerForWeb/
#   <out-dir> : staging destination, e.g. _site
set -euo pipefail

OUT="${1:?usage: build-ssconverter-pages.sh <out-dir>}"
: "${SITE_BASE:?SITE_BASE is required, e.g. /SSPlayerForWeb/}"

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd -P)"
MANIFEST="$ROOT_DIR/packages/ssconverter-web/versions.json"
REPO="cri-middleware/SpriteStudio-SDK"
CONVERTER_ASSET="spritestudio-sdk-converter-web.zip"

command -v jq >/dev/null || { echo "jq is required"; exit 1; }

# Fetch a version's converter wasm into <src>/packages/ssconverter-core/wasm,
# replacing whatever was there (a previous iteration or `download:wasm`).
fetch_wasm() {
  local src="$1" sdk="$2"
  local wasm_dir="$src/packages/ssconverter-core/wasm"
  local tmp url
  tmp="$(mktemp -d)"
  url="https://github.com/$REPO/releases/download/$sdk/$CONVERTER_ASSET"
  echo "   downloading $url"
  curl -fL -o "$tmp/converter.zip" "$url"
  rm -rf "$wasm_dir"
  mkdir -p "$wasm_dir"
  unzip -q -o "$tmp/converter.zip" -d "$wasm_dir"
  rm -rf "$tmp"
}

# Build ssconverter-web from a source tree and stage the output.
#   $1 src tree (repo root or worktree)  $2 schema  $3 sdk tag
build_from() {
  local src="$1" schema="$2" sdk="$3"
  fetch_wasm "$src" "$sdk"
  # ssconverter-web imports the engine from @spritestudio/ssconverter-core (its
  # dist + bundled wasm), so build the core against this version's wasm first.
  pnpm -C "$src" --filter=@spritestudio/ssconverter-core build
  # Build with a per-version base so assets resolve under /<repo>/ssconverter/<schema>/.
  pnpm -C "$src" --filter=ssconverter-web exec tsc
  pnpm -C "$src" --filter=ssconverter-web exec vite build --base="${SITE_BASE}ssconverter/${schema}/"
  local dest="$OUT/ssconverter/$schema"
  rm -rf "$dest"
  mkdir -p "$dest"
  cp -R "$src/packages/ssconverter-web/dist/." "$dest/"
}

# Prune any leftover worktrees on exit (belt-and-suspenders; each is also removed
# inline right after use).
trap 'git -C "$ROOT_DIR" worktree prune 2>/dev/null || true' EXIT

mkdir -p "$OUT/ssconverter"
# Expose the manifest to the site so the app can render a version switcher.
cp "$MANIFEST" "$OUT/ssconverter/versions.json"

LATEST="$(jq -r '.latest' "$MANIFEST")"

# Process substitution (not a pipe) keeps the loop in the main shell so `set -e`
# aborts the whole script if any single version fails to build.
while read -r row; do
  SCHEMA="$(jq -r '.schema' <<<"$row")"
  SDK="$(jq -r '.sdk' <<<"$row")"
  REF="$(jq -r '.ref // empty' <<<"$row")"

  if [ -n "$REF" ]; then
    echo "== ssconverter $SCHEMA  (SDK wasm: $SDK, source: $REF) =="
    WT="$(mktemp -d)/wt"   # git worktree add requires a non-existent path
    git -C "$ROOT_DIR" worktree add --detach "$WT" "$REF"
    # Install the pinned ref's own deps so it builds with its era's toolchain.
    pnpm -C "$WT" install --frozen-lockfile
    build_from "$WT" "$SCHEMA" "$SDK"
    git -C "$ROOT_DIR" worktree remove --force "$WT"
  else
    echo "== ssconverter $SCHEMA  (SDK wasm: $SDK, source: working tree) =="
    build_from "$ROOT_DIR" "$SCHEMA" "$SDK"
  fi
done < <(jq -c '.versions[]' "$MANIFEST")

# Redirect bare /ssconverter/ to the latest schema version.
cat > "$OUT/ssconverter/index.html" <<HTML
<!doctype html>
<meta charset="utf-8">
<meta http-equiv="refresh" content="0; url=./${LATEST}/">
<link rel="canonical" href="./${LATEST}/">
<title>SpriteStudio Converter Web</title>
<a href="./${LATEST}/">SpriteStudio Converter Web (${LATEST})</a>
HTML

echo "ssconverter versions staged under $OUT/ssconverter (latest: $LATEST)"
