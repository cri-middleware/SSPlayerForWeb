#!/usr/bin/env bash
#
# Build every release artifact locally -- and publish none of them: the npm
# tarballs of the public packages and the plugin archives that go out as GitHub
# Releases, side by side in one directory with SHA256SUMS over the lot.
#
#   scripts/build-release.sh                          # everything
#   scripts/build-release.sh skip=install,wasm,test   # iterate
#   scripts/build-release.sh sdk=build                # compile the wasm instead
#   scripts/build-release.sh out=/tmp/rel             # somewhere else
#
# A release here is two channels, so both are built (see release.yml):
#
#   npm       The PUBLIC packages. `pnpm pack` is the same packing path
#             `pnpm publish` takes -- the `files` allow-list, the `prepack`
#             artifact guard, `workspace:^` rewritten to a real range -- so what
#             lands here is what would be uploaded, minus the upload.
#
#   plugins   The PRIVATE packages, which are never on npm. Each one's own
#             `pack` script produces exactly the file release.yml attaches to
#             the Release it cuts.
#
# release.yml runs this script for the plugin assets it uploads, so CI and a
# local run cannot drift: the archives inspected here are the ones the workflow
# attaches to the Releases, built the same way and checked the same way. The
# workflow keeps what is GitHub's -- the checkout, the npm publish, the Releases
# themselves -- and reads <out>/manifest.json for what to attach to which.
#
# The npm half is the exception, and cannot be otherwise: `changeset publish`
# packs and uploads from the workspace itself, so there is no tarball to hand
# it. Building those here buys the look BEFORE the release that the workflow
# cannot offer -- an npm version is immutable, so the first time anyone would
# otherwise see a tarball is after it can no longer be fixed.
#
# The versions are the working tree's, and this does not touch them.
# `changeset version` runs inside the release, so a run from main before it
# produces artifacts one bump behind what will be published; when changesets are
# pending, the summary says so and names what each package would become. Bumping
# here instead would leave the release's own decision half-made in the working
# tree -- and it is a decision this script has no business making.
#
# The checks are the ones that would otherwise ship:
#
#   A `workspace:` range left in a published manifest. Nothing in the workspace
#   notices -- it resolves locally -- and an installed copy is unbuildable.
#
#   dist/ or wasm/ missing from a tarball. They are gitignored build outputs
#   that the `files` allow-list ships, so a pack that skipped the build uploads
#   those paths simply absent and npm takes it. That is what each package's
#   `prepack` guard is for; here it is re-checked from inside the finished
#   tarball, which is the only place it can be seen the way a consumer sees it.
#
#   The RPG Maker MZ plugin carrying the SIMD runtime. MZ runs on NW.js, whose
#   bundled Chromium predates wasm simd128: the plugin installs, loads, and then
#   dies on the wasm, in a way nothing in this repo would reproduce.
#
#   ssplayer.tbp renamed. TyranoBuilder derives the plugin id from the filename
#   and then reads <id>/<id>.builder.js out of the archive it just extracted, so
#   a version in the name installs nothing at all.
set -euo pipefail

APP="$(basename "$0")"
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

# Stages, in the order they run. Neither the checksums nor the verification are
# stages: they are cheap and they read whatever the stages produced.
STAGES="install wasm build test npm plugins"

# The plugin channel, one row per Release asset: <package>|<dir>|<path under
# packages/<dir>, %v = version>. The only place these names live -- release.yml
# takes them out of the manifest this run writes -- and the drift guard below
# refuses to run at all when a private package grows a `pack` script without a
# row here, which would otherwise read as a release with one plugin missing.
PLUGIN_ROWS="@spritestudio/ssplayer-rmmz|ssplayer-rmmz|dist/pack/ssplayer-rmmz-plugin-%v.zip
@spritestudio/ssplayer-tyranoscript|ssplayer-tyranoscript|dist/pack/ssplayer-tyranoscript-plugin-%v.zip
@spritestudio/ssplayer-tyranobuilder|ssplayer-tyranobuilder|dist/pack/ssplayer.tbp"

# --- options --------------------------------------------------------------

OUT="release-dist"
SDK="download"
SKIP=""
VERIFY="yes"
CLEAN=""   # resolved after parsing: yes when nothing is skipped, no otherwise

usage () {
  echo "Usage: $APP [options]"
  echo "$APP options:"
  echo "  out=<dir>               Where the artifacts and SHA256SUMS land (default:"
  echo "                          $OUT). Relative paths resolve against the"
  echo "                          current directory."
  echo "  sdk=<download|build|skip>"
  echo "                          Where the SDK wasm comes from (default: $SDK)."
  echo "                          download = download-sdk.sh, the pre-built release for"
  echo "                          scripts/SDK_VERSION.txt (what the release workflow"
  echo "                          uses). build = build-runtime.sh, compiled from the"
  echo "                          Rust source in the submodule (release mode; needs"
  echo "                          rustup + wasm-pack) -- the way through when that SDK"
  echo "                          release does not exist yet. skip = keep"
  echo "                          packages/*/wasm as it stands."
  echo "  skip=<a,b,...>          Stages to leave out. One or more of:"
  echo "                          $STAGES"
  echo "  verify=<yes|no>         Re-open the finished artifacts and check them"
  echo "                          (default: $VERIFY)."
  echo "  clean=<yes|no>          Delete <out> before building (default: yes, or no"
  echo "                          when skip= is given, so a partial run keeps what an"
  echo "                          earlier one produced)."
    echo "  in=                     Accepted and ignored here. The family's build-release"
  echo "                          scripts share out= clean= verify= in= sdk= skip=,"
  echo "                          so one command line drives all of them."
echo "  -h | --help             Show this help"
  echo ""
  echo "Stages:"
  echo "  install   pnpm install --frozen-lockfile"
  echo "  wasm      the SDK runtime + converter wasm (not in git), per sdk="
  echo "  build     pnpm run build (every package except docs)"
  echo "  test      pnpm run test -- the gate the release runs before it publishes"
  echo "  npm       pnpm pack for each public package -> <out>/npm"
  echo "  plugins   each private package's pack script -> <out>/plugins"
  echo ""
  echo "Output: <out>/npm/*.tgz (the npm channel), <out>/plugins/* (the GitHub"
  echo "Releases channel), <out>/manifest.json naming both (release.yml reads it to"
  echo "cut the plugin Releases) and SHA256SUMS over the lot."
  echo ""
  echo "This builds a release; it does not make one. Nothing here publishes, tags,"
  echo "commits, or bumps a version: the artifacts carry the versions the working"
  echo "tree has right now, and the release bumps them itself (changeset version)."
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
        out)    OUT="$value" ;;
        # Lower-cased, because these are keywords rather than paths.
        sdk)    SDK="$(printf '%s' "$value" | tr '[:upper:]' '[:lower:]')" ;;
        verify) VERIFY="$(printf '%s' "$value" | tr '[:upper:]' '[:lower:]')" ;;
        clean)  CLEAN="$(printf '%s' "$value" | tr '[:upper:]' '[:lower:]')" ;;
        skip)   SKIP="$(printf '%s' "$value" | tr ',' ' ')" ;;
        # Accepted so one command line drives build-release in every repository
        # of the family; this one has no use for them.
        in) echo "$APP: ${key}= does not apply here; ignored" >&2 ;;
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

case "$SDK" in
  download|build|skip) ;;
  *) echo "$APP: sdk must be download, build or skip (got '$SDK')" >&2; exit 2 ;;
esac

case "$VERIFY" in
  yes|no) ;;
  *) echo "$APP: verify must be yes or no (got '$VERIFY')" >&2; exit 2 ;;
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

FAILED=""
fail () {
  FAILED="${FAILED}
  $1"
}

echo "options"
echo "  out    => $OUT"
echo "  sdk    => $SDK"
echo "  skip   => ${SKIP:-(nothing)}"
echo "  verify => $VERIFY"
echo "  clean  => $CLEAN"

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

# `unzip` and `tar` are how the verification reads the finished artifacts
# back. Packing needs neither: the pack scripts write their zips with fflate.
for tool in unzip tar; do
  command -v "$tool" > /dev/null 2>&1 || {
    echo "$APP: $tool not found -- it is what packages or re-opens the archives" >&2
    exit 1
  }
done

# The runners have sha256sum (coreutils); macOS ships shasum instead. Both write
# the same `<hash>  <name>` lines and both take -c, so SHA256SUMS is identical
# either way.
if command -v sha256sum > /dev/null 2>&1; then
  sha256 () { sha256sum "$@"; }
elif command -v shasum > /dev/null 2>&1; then
  sha256 () { shasum -a 256 "$@"; }
else
  echo "$APP: neither sha256sum nor shasum found -- one of them writes SHA256SUMS" >&2
  exit 1
fi

# sdk=build compiles the Rust runtime in the submodule. (wasm-pack itself is not
# checked for here: SpriteStudio-SDK/scripts/release-web.sh already does it, and
# it also accepts one that only lives in ~/.cargo/bin.)
if [ "$SDK" = "build" ] && ! skipping wasm && [ ! -d "$ROOT_DIR/SpriteStudio-SDK/libs/ssruntime" ]; then
  echo "$APP: sdk=build needs SpriteStudio-SDK/libs/ssruntime -- the submodule is not checked out" >&2
  echo "$APP: fix it with 'git submodule update --init --recursive'" >&2
  exit 1
fi

# Every workspace path is relative to the repo root, so build from there however
# the script was invoked.
cd "$ROOT_DIR"

# --- what is in this release ----------------------------------------------
#
# The channel a package goes out on is a property of the package, not a list
# kept here: `private: true` is exactly what keeps it off npm, and it is what
# release.yml splits on too.
INVENTORY="$(node -e '
const { readdirSync, existsSync, readFileSync } = require("node:fs");
const { join } = require("node:path");
const dir = join(process.argv[1], "packages");
for (const e of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : 1)) {
  if (!e.isDirectory()) continue;
  const manifest = join(dir, e.name, "package.json");
  if (!existsSync(manifest)) continue;
  const p = JSON.parse(readFileSync(manifest, "utf8"));
  console.log([
    e.name,
    p.name ?? "",
    p.version ?? "",
    p.private ? "private" : "public",
    (p.scripts ?? {}).pack ? "pack" : "-",
  ].join("|"));
}' "$ROOT_DIR")"

PUBLIC_PKGS=""   # newline-separated "<dir>|<name>|<version>"
PLUGIN_PKGS=""   # newline-separated "<dir>|<name>|<version>|<artifact>"
NEITHER=""       # private, no pack script -- not a release artifact at all

while IFS='|' read -r dir name version visibility packable; do
  [ -n "$dir" ] || continue
  if [ "$visibility" = "public" ]; then
    PUBLIC_PKGS="${PUBLIC_PKGS}${dir}|${name}|${version}
"
  elif [ "$packable" = "pack" ]; then
    row="$(printf '%s\n' "$PLUGIN_ROWS" | grep "^${name}|" || true)"
    if [ -z "$row" ]; then
      echo "$APP: $name is private and has a pack script, but no row in PLUGIN_ROWS" >&2
      echo "$APP: add one -- release.yml reads the manifest, so it needs no change" >&2
      exit 1
    fi
    pattern="${row##*|}"
    PLUGIN_PKGS="${PLUGIN_PKGS}${dir}|${name}|${version}|${pattern//%v/$version}
"
  else
    NEITHER="${NEITHER}${dir}|${name}|${version}
"
  fi
done <<< "$INVENTORY"

echo ""
echo "packages"
while IFS='|' read -r dir name version; do
  [ -n "$dir" ] || continue
  printf '  npm      %-40s %s\n' "$name" "$version"
done <<< "$PUBLIC_PKGS"
while IFS='|' read -r dir name version artifact; do
  [ -n "$dir" ] || continue
  printf '  release  %-40s %s  (%s)\n' "$name" "$version" "$(basename "$artifact")"
done <<< "$PLUGIN_PKGS"
while IFS='|' read -r dir name version; do
  [ -n "$dir" ] || continue
  printf '  --       %-40s %s  (private, no pack script -- not a release artifact)\n' "$name" "$version"
done <<< "$NEITHER"

# --- what the release would call them --------------------------------------
#
# The tree is not bumped here, so say out loud where these versions stand
# relative to the ones that will be published.
PENDING=0
for f in "$ROOT_DIR"/.changeset/*.md; do
  [ -e "$f" ] || continue
  case "$(basename "$f")" in README.md) ;; *) PENDING=$((PENDING + 1)) ;; esac
done
if [ "$PENDING" != "0" ]; then
  echo ""
  echo "note: $PENDING changeset(s) pending -- the release bumps before it builds, so"
  echo "      the artifacts below are named one bump behind what it will publish:"
  # `changeset status` REWRITES .changeset/pre.json as a side effect: it
  # re-serializes the pre state and drops initialVersions/changesets from it.
  # Nothing in this script is allowed to leave a modified working tree, and a
  # gutted pre.json is not a harmless diff -- initialVersions is what the pre
  # line's exit bumps from. So snapshot it and put it back.
  PRE_JSON="$ROOT_DIR/.changeset/pre.json"
  PRE_BACKUP=""
  if [ -f "$PRE_JSON" ]; then
    PRE_BACKUP="$(mktemp)"
    cp "$PRE_JSON" "$PRE_BACKUP"
  fi

  STATUS_JSON="$(mktemp)"
  if pnpm changeset status --output="$STATUS_JSON" > /dev/null 2>&1; then
    node -e '
      const { readFileSync } = require("node:fs");
      const s = JSON.parse(readFileSync(process.argv[1], "utf8"));
      for (const r of s.releases ?? []) {
        if (r.type === "none") continue;
        console.log(`        ${r.name}: ${r.oldVersion} -> ${r.newVersion}`);
      }
    ' "$STATUS_JSON" || true
  fi
  rm -f "$STATUS_JSON"

  if [ -n "$PRE_BACKUP" ]; then
    # Only when it actually changed, so an untouched file keeps its mtime.
    cmp -s "$PRE_BACKUP" "$PRE_JSON" || cp "$PRE_BACKUP" "$PRE_JSON"
    rm -f "$PRE_BACKUP"
  elif [ -f "$PRE_JSON" ]; then
    rm -f "$PRE_JSON"
  fi
fi

# Pre mode changes what a version even means, and it is easy to forget it is on.
if [ -f "$ROOT_DIR/.changeset/pre.json" ]; then
  PRE_MODE="$(node -p "require('$ROOT_DIR/.changeset/pre.json').mode" 2>/dev/null || echo "")"
  PRE_TAG="$(node -p "require('$ROOT_DIR/.changeset/pre.json').tag" 2>/dev/null || echo "")"
  if [ "$PRE_MODE" = "pre" ]; then
    echo ""
    echo "note: changesets pre mode is ACTIVE (tag: $PRE_TAG) -- the release publishes"
    echo "      under the '$PRE_TAG' dist-tag, so there is no 'latest' and a consumer has"
    echo "      to ask for <pkg>@$PRE_TAG until 'pnpm changeset pre exit' ends the line."
  fi
fi

if [ "$CLEAN" = "yes" ]; then
  rm -rf "$OUT"
fi
mkdir -p "$OUT"

# --- install ---------------------------------------------------------------
if stage install "pnpm install --frozen-lockfile"; then
  pnpm install --frozen-lockfile
fi

# --- the wasm --------------------------------------------------------------
#
# Not in git, and shipped inside two of the tarballs and all three plugin
# archives. sdk=download takes the pre-built release for scripts/SDK_VERSION.txt
# -- what release.yml does; sdk=build compiles it from the submodule in release
# mode, which is the way through when that SDK release does not exist yet.
case "$SDK" in
  download) wasm_what="download the SDK wasm (runtime, no-SIMD runtime, converter)" ;;
  build)    wasm_what="build the SDK wasm from source (release mode)" ;;
  skip)     wasm_what="keep packages/*/wasm as it stands" ;;
esac
if stage wasm "$wasm_what"; then
  case "$SDK" in
    download) pnpm run download:wasm ;;
    build)    ./scripts/build-runtime.sh build=release ;;
    skip)     echo "   sdk=skip" ;;
  esac
fi

# Whatever brought it, it has to be there: ssplayer-core ships wasm/ in its
# tarball, and the RPG Maker MZ plugin needs the no-SIMD variant specifically.
for w in packages/ssplayer-core/wasm/ssruntime_bg.wasm \
         packages/ssplayer-core/wasm-nosimd/ssruntime_bg.wasm \
         packages/ssconverter-core/wasm/ssconverter_bg.wasm; do
  if [ ! -f "$ROOT_DIR/$w" ]; then
    echo "$APP: $w is missing -- the SDK wasm is not installed" >&2
    echo "$APP: run 'pnpm run download:wasm', or pass sdk=download / sdk=build" >&2
    exit 1
  fi
done

# --- build -----------------------------------------------------------------
if stage build "build the packages"; then
  pnpm run build
fi

# --- test ------------------------------------------------------------------
# The release runs this before it versions anything, because an npm version is
# immutable once published. A rehearsal that skipped it would rehearse the wrong
# thing.
if stage test "pnpm run test"; then
  pnpm run test
fi

# --- the npm channel -------------------------------------------------------
if stage npm "pack the public packages"; then
  mkdir -p "$OUT/npm"
  while IFS='|' read -r dir name version; do
    [ -n "$dir" ] || continue
    # `prepack` (verify-publish-artifacts.mjs) runs as part of this and refuses
    # a package whose advertised dist/wasm is not on disk.
    pnpm --filter "$name" pack --pack-destination "$OUT/npm" > /dev/null
    # npm's tarball name: the scope's @ dropped, its / turned into a dash.
    tgz="$(printf '%s' "$name" | sed 's|^@||; s|/|-|g')-${version}.tgz"
    if [ ! -f "$OUT/npm/$tgz" ]; then
      echo "$APP: pnpm pack did not produce $tgz" >&2
      exit 1
    fi
    echo "   npm/$tgz"
  done <<< "$PUBLIC_PKGS"
fi

# --- the GitHub Releases channel -------------------------------------------
if stage plugins "pack the private plugins"; then
  mkdir -p "$OUT/plugins"
  while IFS='|' read -r dir name version artifact; do
    [ -n "$dir" ] || continue
    pnpm --filter "$name" run pack > /dev/null
    src="$ROOT_DIR/packages/$dir/$artifact"
    if [ ! -f "$src" ]; then
      echo "$APP: $name's pack script did not produce $artifact" >&2
      exit 1
    fi
    cp "$src" "$OUT/plugins/"
    echo "   plugins/$(basename "$artifact")"
  done <<< "$PLUGIN_PKGS"
fi

# --- the manifest ----------------------------------------------------------
# What this run produced, per channel, as data rather than as a listing to be
# read. release.yml reads `.plugins[]` out of it to cut one GitHub Release per
# plugin, which is what keeps the artifact names in exactly one place -- the
# PLUGIN_ROWS table above -- so adding a plugin needs no change to the workflow.
#
# It lists what is on disk, not what this run was asked to build, so a channel
# whose stage was skipped comes out empty and the workflow can say so.
echo ""
echo ">> [manifest] writing manifest.json"
{
  while IFS='|' read -r dir name version; do
    [ -n "$dir" ] || continue
    tgz="$(printf '%s' "$name" | sed 's|^@||; s|/|-|g')-${version}.tgz"
    if [ -f "$OUT/npm/$tgz" ]; then
      printf 'npm|%s|%s|npm/%s\n' "$name" "$version" "$tgz"
    fi
  done <<< "$PUBLIC_PKGS"
  while IFS='|' read -r dir name version artifact; do
    [ -n "$dir" ] || continue
    base="$(basename "$artifact")"
    if [ -f "$OUT/plugins/$base" ]; then
      printf 'plugins|%s|%s|plugins/%s\n' "$name" "$version" "$base"
    fi
  done <<< "$PLUGIN_PKGS"
} | node -e '
  let input = "";
  process.stdin.on("data", (d) => { input += d; }).on("end", () => {
    const manifest = { npm: [], plugins: [] };
    for (const line of input.split("\n")) {
      if (!line) continue;
      const [channel, pkg, version, file] = line.split("|");
      manifest[channel].push({ package: pkg, version, file });
    }
    require("node:fs").writeFileSync(process.argv[1], JSON.stringify(manifest, null, 2) + "\n");
  });
' "$OUT/manifest.json"
echo "   npm: $(node -p "require('$OUT/manifest.json').npm.length"), plugins: $(node -p "require('$OUT/manifest.json').plugins.length")"

# --- checksums -------------------------------------------------------------
# Over whatever is in <out>, not over what this run produced: with clean=no a
# partial run leaves an earlier run's artifacts in place, and a SHA256SUMS that
# covered only half of them would be worse than none.
step_files=()
while IFS= read -r f; do
  step_files+=("$f")
done < <(cd "$OUT" && find . -type f ! -name SHA256SUMS | sed 's|^\./||' | LC_ALL=C sort)

echo ""
if [ "${#step_files[@]}" -eq 0 ]; then
  echo ">> [checksums] nothing in $OUT to sum"
  echo ""
  echo "$APP: every stage that produces a file was skipped -- nothing was built." >&2
  exit 1
fi
echo ">> [checksums] writing SHA256SUMS"
( cd "$OUT" && sha256 "${step_files[@]}" > SHA256SUMS )
echo "   ${#step_files[@]} artifacts"

# --- verify ----------------------------------------------------------------
if [ "$VERIFY" = "yes" ]; then
  echo ""
  echo ">> [verify] re-opening $OUT"

  # Somewhere outside the repo to unpack into: nothing here belongs in the
  # working tree, and a leftover directory would look like a build output.
  CHECK="$(mktemp -d)"
  trap 'rm -rf "$CHECK"' EXIT

  # -- the npm tarballs --
  # As with the plugins below: checked once the channel has been built at least
  # once, and keyed on the name each package would be published under.
  if [ -n "$(find "$OUT/npm" -type f 2>/dev/null | head -n 1)" ]; then
    while IFS='|' read -r dir name version; do
      [ -n "$dir" ] || continue
      tgz="$OUT/npm/$(printf '%s' "$name" | sed 's|^@||; s|/|-|g')-${version}.tgz"
      if [ ! -f "$tgz" ]; then
        fail "$(basename "$tgz") is missing from the npm channel"
        continue
      fi

      entries="$CHECK/$(basename "$tgz").list"
      tar -tzf "$tgz" > "$entries"
      manifest="$CHECK/$(basename "$tgz").json"
      tar -xzOf "$tgz" package/package.json > "$manifest"

      # The name and version inside are the ones this is filed under. Catches a
      # tarball built from a tree edited after the name was computed, and a
      # stale one left behind by an earlier run.
      packed_name="$(node -p "require('$manifest').name" 2>/dev/null || echo "")"
      packed_version="$(node -p "require('$manifest').version" 2>/dev/null || echo "")"
      [ "$packed_name" = "$name" ] || fail "$(basename "$tgz") contains name $packed_name, expected $name"
      [ "$packed_version" = "$version" ] || fail "$(basename "$tgz") contains version $packed_version, expected $version"

      # `private: true` would be refused by the registry, but by then the run
      # has already published everything alphabetically before it.
      if [ "$(node -p "require('$manifest').private === true" 2>/dev/null || echo false)" = "true" ]; then
        fail "$(basename "$tgz") is marked private -- it cannot go to npm"
      fi

      # A workspace: range resolves inside this repo and nowhere else.
      if grep -q 'workspace:' "$manifest"; then
        fail "$(basename "$tgz") still has a workspace: range in its dependencies"
      fi

      # Everything the `files` allow-list promises is actually inside. dist/ and
      # wasm/ are gitignored build outputs, so this is where a pack that ran
      # without a build shows up.
      while IFS= read -r entry; do
        [ -n "$entry" ] || continue
        grep -q "^package/${entry}" "$entries" \
          || fail "$(basename "$tgz") is missing '$entry' (it is in the files allow-list)"
        # wasm/ is only worth shipping if the binary is in it.
        if [ "$entry" = "wasm" ] && ! grep -q "^package/wasm/.*\.wasm$" "$entries"; then
          fail "$(basename "$tgz") has a wasm/ directory with no .wasm in it"
        fi
      done <<< "$(node -p "(require('$ROOT_DIR/packages/$dir/package.json').files || []).join('\n')")"
    done <<< "$PUBLIC_PKGS"
  fi

  # ssplayer-core ships the runtime binary TWICE on purpose: wasm/ is the
  # wasm-bindgen package the bundler entry imports, dist/ is the copy the IIFE
  # build loads by URL from a CDN (its build step copies it there). A tarball
  # with only the first one is a bundler-only release, and the CDN snippets in
  # the docs 404 against it.
  core_tgz="$OUT/npm/spritestudio-ssplayer-core-$(node -p "require('$ROOT_DIR/packages/ssplayer-core/package.json').version").tgz"
  if [ -f "$core_tgz" ]; then
    tar -tzf "$core_tgz" | grep -q '^package/dist/ssruntime_bg\.wasm$' \
      || fail "$(basename "$core_tgz") has no dist/ssruntime_bg.wasm (the copy the IIFE build loads by URL)"
  fi

  # -- the plugin archives --
  #
  # Keyed on the expected filenames, and only once the channel has been built at
  # least once (an absent plugins/ just means the stage never ran). For the .tbp
  # the filename IS the plugin id, so a renamed one has to read as missing
  # rather than as present-under-another-name.
  if [ -n "$(find "$OUT/plugins" -type f 2>/dev/null | head -n 1)" ]; then
    while IFS='|' read -r dir name version artifact; do
      [ -n "$dir" ] || continue
      [ -f "$OUT/plugins/$(basename "$artifact")" ] \
        || fail "$(basename "$artifact") is missing from the plugins channel"
    done <<< "$PLUGIN_PKGS"
  fi

  rmmz_zip="$OUT/plugins/ssplayer-rmmz-plugin-$(node -p "require('$ROOT_DIR/packages/ssplayer-rmmz/package.json').version").zip"
  if [ -f "$rmmz_zip" ]; then
    # Flat, because RPG Maker MZ loads plugins as files in js/plugins/ and the
    # plugin finds its wasm next to itself (document.currentScript).
    for f in ssplayer-rpgmakermz.js ssruntime_bg.wasm; do
      unzip -Z1 "$rmmz_zip" | grep -qx "$f" || fail "$(basename "$rmmz_zip") has no $f at the archive root"
    done
    # And the wasm is the no-SIMD build. MZ's NW.js Chromium predates simd128,
    # so the SIMD one installs, loads, and dies -- on a host nothing here runs.
    if unzip -Z1 "$rmmz_zip" | grep -qx ssruntime_bg.wasm; then
      unzip -p "$rmmz_zip" ssruntime_bg.wasm | cmp -s - "$ROOT_DIR/packages/ssplayer-core/wasm-nosimd/ssruntime_bg.wasm" \
        || fail "$(basename "$rmmz_zip") does not carry the no-SIMD runtime (RPG Maker MZ cannot load a simd128 wasm)"
    fi
  fi

  tyrano_zip="$OUT/plugins/ssplayer-tyranoscript-plugin-$(node -p "require('$ROOT_DIR/packages/ssplayer-tyranoscript/package.json').version").zip"
  if [ -f "$tyrano_zip" ]; then
    # One folder, dropped whole into data/others/plugin/.
    for f in ssplayer/init.ks ssplayer/main.js ssplayer/ssruntime_bg.wasm ssplayer/readme.txt; do
      unzip -Z1 "$tyrano_zip" | grep -qx "$f" || fail "$(basename "$tyrano_zip") has no $f"
    done
    if unzip -Z1 "$tyrano_zip" | grep -qx ssplayer/readme.txt; then
      # The packer fills the version into the readme a creator actually reads.
      if unzip -p "$tyrano_zip" ssplayer/readme.txt | grep -q '{{VERSION}}'; then
        fail "$(basename "$tyrano_zip") ships readme.txt with {{VERSION}} unsubstituted"
      fi
    fi
  fi

  tbp="$OUT/plugins/ssplayer.tbp"
  if [ -f "$tbp" ]; then
    # The builder derives the plugin id from the FILENAME, then reads
    # <id>/<id>.builder.js out of what it extracted. Both halves of that have to
    # hold, and neither is visible from inside the repo.
    tops="$(unzip -Z1 "$tbp" | sed 's|/.*||' | LC_ALL=C sort -u)"
    if [ "$tops" != "ssplayer" ]; then
      fail "ssplayer.tbp does not hold exactly one top-level folder named 'ssplayer' (found: $(printf '%s' "$tops" | tr '\n' ' '))"
    fi
    for f in ssplayer/ssplayer.builder.js ssplayer/main.js ssplayer/init.ks \
             ssplayer/ssruntime_bg.wasm ssplayer/ssconverter_bg.wasm; do
      unzip -Z1 "$tbp" | grep -qx "$f" || fail "ssplayer.tbp has no $f"
    done
  fi

  # -- the copy-paste snippets --
  # The docs, the READMEs and examples/cdn pin exact versions of these packages.
  # The release rewrites them right after the bump; a mismatch HERE means the
  # tree's own snippets already disagree with the tree's own versions, which the
  # release would carry straight through.
  if ! pnpm run check:docs > /dev/null 2>&1; then
    fail "the version pins in the docs/READMEs/examples disagree with package.json (run 'pnpm run sync:docs')"
  fi

  ( cd "$OUT" && sha256 -c SHA256SUMS > /dev/null ) || fail "SHA256SUMS does not verify"

  if [ -n "$FAILED" ]; then
    echo "" >&2
    echo "$APP: the artifacts in $OUT are not shippable:$FAILED" >&2
    exit 1
  fi
  echo "   all checks passed"
else
  echo ""
  echo ">> [verify] verify=no -- the artifacts are not checked"
fi

# --- done ------------------------------------------------------------------
echo ""
echo "$APP: done -> $OUT"
echo ""
( cd "$OUT" && find . -type f | sed 's|^\./||' | LC_ALL=C sort | while IFS= read -r f; do
    printf '  %10s  %s\n' "$(wc -c < "$f" | tr -d ' ')" "$f"
  done )
echo ""
echo "$APP: nothing was published. This is what a release would upload:"
echo "  npm/*.tgz     what 'changeset publish' sends to npm (it packs from the"
echo "                workspace itself, so it never reads these files)"
echo "  plugins/*     the very files release.yml attaches to the per-plugin"
echo "                GitHub Releases -- it runs this script to build them"
if [ -d "$OUT/npm" ] && [ -n "$(find "$OUT/npm" -name '*.tgz' 2>/dev/null | head -n 1)" ]; then
  echo ""
  echo "$APP: try a tarball before shipping it -- install it into a scratch project:"
  echo "  pnpm add $OUT/npm/<name>.tgz   (npm / yarn take the same file)"
fi
