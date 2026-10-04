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
#             lands here is the file release.yml uploads.
#
#   plugins   The PRIVATE packages, which are never on npm. Each one's own
#             `pack` script produces exactly the file release.yml attaches to
#             the Release it cuts.
#
# release.yml runs this script for everything it uploads, so CI and a local run
# cannot drift: the tarballs it publishes to npm and the archives it attaches to
# the Releases are the files built and checked here, the same way. The workflow
# keeps what is GitHub's and npm's -- the checkout, the version commit, the
# publish, the tags and the Releases -- and reads <out>/manifest.json for which
# file is which. Run locally before a release, this is the one look at an npm
# tarball anyone gets while it can still be fixed: a published version is
# immutable.
#
# The versions are the working tree's, and this does not touch them. A release
# sets them first (scripts/set-versions.mjs), so a run without that step builds
# under the versions the tree has now. Setting them here would leave the
# release's own decision half-made in the working tree -- and it is a decision
# this script has no business making.
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
  echo "publish the tarballs and cut the Releases) and SHA256SUMS over the lot."
  echo ""
  echo "This builds a release; it does not make one. Nothing here publishes, tags,"
  echo "commits, or sets a version: the artifacts carry the versions the working"
  echo "tree has right now, which a release sets first (scripts/set-versions.mjs)."
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
# read. release.yml publishes each `.npm[]` tarball and tags and drafts a
# Release for every entry as `<dir>-v<version>`, which is what keeps the
# artifact names in exactly one place -- the PLUGIN_ROWS table above -- so
# adding a package needs no change to the workflow.
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
      printf 'npm|%s|%s|%s|npm/%s\n' "$name" "$dir" "$version" "$tgz"
    fi
  done <<< "$PUBLIC_PKGS"
  while IFS='|' read -r dir name version artifact; do
    [ -n "$dir" ] || continue
    base="$(basename "$artifact")"
    if [ -f "$OUT/plugins/$base" ]; then
      printf 'plugins|%s|%s|%s|plugins/%s\n' "$name" "$dir" "$version" "$base"
    fi
  done <<< "$PLUGIN_PKGS"
} | node -e '
  let input = "";
  process.stdin.on("data", (d) => { input += d; }).on("end", () => {
    const manifest = { npm: [], plugins: [] };
    for (const line of input.split("\n")) {
      if (!line) continue;
      const [channel, pkg, dir, version, file] = line.split("|");
      manifest[channel].push({ package: pkg, dir, version, file });
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

  # ssplayer-core ships the runtime binary TWICE on purpose. wasm/ is the
  # wasm-bindgen package, and its .wasm is the URL every CDN snippet in the docs
  # hands to initialize(). dist/ holds the copy the ESM entry finds next to
  # itself (new URL('ssruntime_bg.wasm', import.meta.url)) when initialize() is
  # given no URL -- the file a bundler emits, and the one an ESM import from a
  # CDN fetches; the build step copies it there. A tarball without that copy
  # installs and type-checks, then 404s on the runtime in every bundled app.
  #
  # Every listing below, and the readme, is read into a variable before grep
  # sees it. Piped straight into `grep -q`, grep exits at its first match, the
  # writer dies of SIGPIPE on the rest, and pipefail reports the whole pipeline
  # as failed -- a file that is there reads as missing, and a {{VERSION}} left
  # in reads as substituted.
  core_tgz="$OUT/npm/spritestudio-ssplayer-core-$(node -p "require('$ROOT_DIR/packages/ssplayer-core/package.json').version").tgz"
  if [ -f "$core_tgz" ]; then
    listing="$(tar -tzf "$core_tgz")"
    grep -q '^package/dist/ssruntime_bg\.wasm$' <<< "$listing" \
      || fail "$(basename "$core_tgz") has no dist/ssruntime_bg.wasm (the copy the ESM entry loads when initialize() is given no URL)"
  fi

  # ssplayer-webgl and ssplayer-pixi build ssplayer-core's wasm glue into their
  # CDN bundles, while every CDN snippet loads the runtime that glue drives from
  # ssplayer-core@<its version>/wasm/. The two come out of one wasm-bindgen
  # build and work only as a pair, so a player that goes out under a core
  # version already released has to carry the glue of the runtime that version
  # shipped: the SDK release scripts/SDK_VERSION.txt named at core's tag. The
  # tags are what mark a version released -- release.yml pushes
  # <dir>-v<version> for every package it releases.
  core_version="$(node -p "require('$ROOT_DIR/packages/ssplayer-core/package.json').version")"
  if git -C "$ROOT_DIR" rev-parse -q --verify "refs/tags/ssplayer-core-v${core_version}" > /dev/null; then
    sdk_then="$(git -C "$ROOT_DIR" show "ssplayer-core-v${core_version}:scripts/SDK_VERSION.txt" 2>/dev/null | tr -d '[:space:]' || true)"
    sdk_now="$(tr -d '[:space:]' < "$ROOT_DIR/scripts/SDK_VERSION.txt")"
    if [ "$sdk_then" != "$sdk_now" ]; then
      while IFS='|' read -r dir name version; do
        [ -n "$dir" ] || continue
        # A CDN bundle (`jsdelivr` names it) built on ssplayer-core.
        node -e 'const p = require(process.argv[1]); process.exit(p.jsdelivr && (p.dependencies || {})["@spritestudio/ssplayer-core"] ? 0 : 1)' \
          "$ROOT_DIR/packages/$dir/package.json" || continue
        git -C "$ROOT_DIR" rev-parse -q --verify "refs/tags/${dir}-v${version}" > /dev/null && continue
        fail "$name@$version carries the runtime glue of SDK $sdk_now, but its CDN snippets load the runtime of ssplayer-core@$core_version, released with SDK ${sdk_then:-(unknown)} -- release ssplayer-core too"
      done <<< "$PUBLIC_PKGS"
    fi
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
    listing="$(unzip -Z1 "$rmmz_zip")"
    for f in ssplayer-rpgmakermz.js ssruntime_bg.wasm; do
      grep -qx "$f" <<< "$listing" || fail "$(basename "$rmmz_zip") has no $f at the archive root"
    done
    # And the wasm is the no-SIMD build. MZ's NW.js Chromium predates simd128,
    # so the SIMD one installs, loads, and dies -- on a host nothing here runs.
    if grep -qx ssruntime_bg.wasm <<< "$listing"; then
      unzip -p "$rmmz_zip" ssruntime_bg.wasm | cmp -s - "$ROOT_DIR/packages/ssplayer-core/wasm-nosimd/ssruntime_bg.wasm" \
        || fail "$(basename "$rmmz_zip") does not carry the no-SIMD runtime (RPG Maker MZ cannot load a simd128 wasm)"
    fi
  fi

  tyrano_zip="$OUT/plugins/ssplayer-tyranoscript-plugin-$(node -p "require('$ROOT_DIR/packages/ssplayer-tyranoscript/package.json').version").zip"
  if [ -f "$tyrano_zip" ]; then
    # One folder, dropped whole into data/others/plugin/.
    listing="$(unzip -Z1 "$tyrano_zip")"
    for f in ssplayer/init.ks ssplayer/main.js ssplayer/ssruntime_bg.wasm ssplayer/readme.txt; do
      grep -qx "$f" <<< "$listing" || fail "$(basename "$tyrano_zip") has no $f"
    done
    if grep -qx ssplayer/readme.txt <<< "$listing"; then
      # The packer fills the version into the readme a creator actually reads.
      readme="$(unzip -p "$tyrano_zip" ssplayer/readme.txt)"
      if grep -q '{{VERSION}}' <<< "$readme"; then
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
    listing="$(unzip -Z1 "$tbp")"
    for f in ssplayer/ssplayer.builder.js ssplayer/main.js ssplayer/init.ks \
             ssplayer/ssruntime_bg.wasm ssplayer/ssconverter_bg.wasm; do
      grep -qx "$f" <<< "$listing" || fail "ssplayer.tbp has no $f"
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
echo "  npm/*.tgz     the very files release.yml publishes to npm"
echo "  plugins/*     the very files release.yml attaches to the plugins'"
echo "                GitHub Releases -- it runs this script to build both"
if [ -d "$OUT/npm" ] && [ -n "$(find "$OUT/npm" -name '*.tgz' 2>/dev/null | head -n 1)" ]; then
  echo ""
  echo "$APP: try a tarball before shipping it -- install it into a scratch project:"
  echo "  pnpm add $OUT/npm/<name>.tgz   (npm / yarn take the same file)"
fi
