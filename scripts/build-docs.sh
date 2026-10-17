#!/usr/bin/env bash
#
# Build the documentation site: TypeDoc, then VitePress.
#
#   scripts/build-docs.sh                       # -> docs/.vitepress/dist
#   scripts/build-docs.sh api=no                # skip TypeDoc; prose changes only
#   scripts/build-docs.sh base=/SSPlayerForWeb/ # what pages.yml passes
#
# Three things worth knowing, all of which differ from the sibling repositories:
#
#   1. One build, both locales. VitePress resolves `docs/ja` through its own i18n
#      support, so there is no locale option here and no order to get right --
#      the Zensical siblings need one build per locale precisely because they
#      have neither.
#   2. Dead links fail the build. VitePress checks them by default and the config
#      does not set `ignoreDeadLinks`, so this is the equivalent of the siblings'
#      --strict.
#   3. `base` is env-driven. docs/.vitepress/config.mts reads DOCS_BASE and falls
#      back to '/', because a project site is served under /<repo>/ while local
#      builds are served from the root. Pass base= rather than exporting it.
#
# What this does NOT build: the renderer packages, the examples, and
# ssconverter-web. TypeDoc reads packages/*/src, not their dist; the one dist it
# needs is ssplayer-core's, which the docs package's own `api` script builds
# first. The examples and converter are separate outputs that pages.yml
# assembles around this one.
#
# `vitepress dev` and `vitepress preview` are deliberately not wrapped: they
# validate nothing and are foreground processes with no arguments worth
# defaulting. `pnpm --filter=docs run dev`, `... run preview`.
set -euo pipefail

APP="$(basename "$0")"
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

# --- options --------------------------------------------------------------
API="yes"
BASE="/"

usage () {
  echo "Usage: $APP [options]"
  echo "$APP options:"
  echo "  api=<yes|no>            Regenerate the API reference with TypeDoc first"
  echo "                          (default: $API). api=no builds the prose and whatever"
  echo "                          docs/api already holds -- much faster, and enough when"
  echo "                          nothing under packages/*/src has changed."
  echo "  base=<path>             Public base path, as DOCS_BASE (default: $BASE)."
  echo "                          A GitHub project site needs base=/<repo>/; leave it"
  echo "                          alone for a build you will preview locally."
  echo "  -h | --help             Show this help"
  echo ""
  echo "Output: docs/.vitepress/dist -- one build, both locales (VitePress resolves"
  echo "docs/ja itself). A dead link fails the build."
  echo ""
  echo "Install the toolchain first with scripts/prepare-docs.sh."
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
        # Lower-cased, because this one is a yes/no flag rather than a path.
        api)  API="$(printf '%s' "$value" | tr '[:upper:]' '[:lower:]')" ;;
        base) BASE="$value" ;;
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

# A base that does not start and end with / silently produces a site whose every
# asset URL is wrong, and nothing downstream notices until it is deployed.
case "$BASE" in
  /*/) ;;
  /) ;;
  *) echo "$APP: base must start and end with '/' (got '$BASE')" >&2; exit 2 ;;
esac

echo "options"
echo "  api  => $API"
echo "  base => $BASE"
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

if [ ! -d "$ROOT_DIR/docs/node_modules" ]; then
  echo "$APP: docs/node_modules is missing -- run 'scripts/prepare-docs.sh' first" >&2
  exit 1
fi

# Every workspace path is relative to the repo root, so build from there however
# the script was invoked.
cd "$ROOT_DIR"

# --- build ----------------------------------------------------------------
export DOCS_BASE="$BASE"

if [ "$API" = "yes" ]; then
  echo ">> pnpm --filter=docs run build  (typedoc, then vitepress)"
  pnpm --filter=docs run build
else
  echo ">> pnpm --filter=docs exec vitepress build  (api=no: docs/api left as it is)"
  pnpm --filter=docs exec vitepress build
fi

echo ""
echo "$APP: done -> docs/.vitepress/dist  (base $BASE)"
if [ "$BASE" = "/" ]; then
  echo "$APP: preview it: pnpm --filter=docs run preview"
else
  echo "$APP: built for $BASE, so 'pnpm --filter=docs run preview' will 404 on its"
  echo "$APP: assets unless it is served from that path."
fi
