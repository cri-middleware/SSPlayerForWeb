#!/bin/bash
set -euo pipefail

HELP_APP="$(basename "$0")"
usage () {
    cat <<USAGE
Usage: ${HELP_APP} [--help]
  Compile the SDK's bundled test projects into the examples' asset directories,
  both reference and embedded. Needs node and the built ssconverter-core package.
USAGE
}

for arg in "$@"; do
  case "$arg" in
    -h|--help|help) usage; exit 0 ;;
    *) echo "${HELP_APP}: unknown argument '${arg}'" >&2; usage >&2; exit 2 ;;
  esac
done

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SDK_DIR="$ROOT_DIR/SpriteStudio-SDK"
PIXI_PUBLIC="$ROOT_DIR/examples/pixi-example/public"
WEBGL_PUBLIC="$ROOT_DIR/examples/webgl-example/public"
# override-example only ever plays Ringo, so it takes just that project's output.
OVERRIDE_PUBLIC="$ROOT_DIR/examples/override-example/public"
# TyranoScript serves assets from data/others/ssdata (see tyranoscript-example README).
TYRANO_SSDATA="$ROOT_DIR/examples/tyranoscript-example/data/others/ssdata"

mkdir -p "$PIXI_PUBLIC"
mkdir -p "$WEBGL_PUBLIC"
mkdir -p "$TYRANO_SSDATA"

echo "Compiling SpriteStudio test assets..."
cd "$ROOT_DIR"
# --stem-dir nests each project's output under <out>/<sspj-stem>/, so overall's
# many ssab land in <out>/overall/ and Ringo's in <out>/Ringo/.
node packages/ssconverter-web/scripts/cli.js --stem-dir -o "$PIXI_PUBLIC" SpriteStudio-SDK/tests/overall/overall.sspj
node packages/ssconverter-web/scripts/cli.js --stem-dir -o "$PIXI_PUBLIC" SpriteStudio-SDK/tests/Ringo/Ringo.sspj
node packages/ssconverter-web/scripts/cli.js --stem-dir -o "$PIXI_PUBLIC" SpriteStudio-SDK/tests/Doll/Doll.sspj

# Also emit embedded-texture variants (*_embedded.ssab) so the examples can demo
# SSABs whose textures are inlined (no sibling image files needed).
echo "Compiling embedded-texture variants..."
node packages/ssconverter-web/scripts/cli.js --stem-dir --embedded --suffix _embedded -o "$PIXI_PUBLIC" SpriteStudio-SDK/tests/overall/overall.sspj
node packages/ssconverter-web/scripts/cli.js --stem-dir --embedded --suffix _embedded -o "$PIXI_PUBLIC" SpriteStudio-SDK/tests/Ringo/Ringo.sspj
node packages/ssconverter-web/scripts/cli.js --stem-dir --embedded --suffix _embedded -o "$PIXI_PUBLIC" SpriteStudio-SDK/tests/Doll/Doll.sspj

# Copy compiled assets to webgl-example as well (the overall/, Ringo/ and Doll/ subdirs).
cp -R "$PIXI_PUBLIC/"* "$WEBGL_PUBLIC/"

# override-example: the Override Layer demo runs on Ringo alone (reference
# textures, so the sibling PNG comes along).
mkdir -p "$OVERRIDE_PUBLIC/Ringo"
cp -R "$PIXI_PUBLIC/Ringo/"* "$OVERRIDE_PUBLIC/Ringo/"

# tyranoscript-example uses the REFERENCE Ringo (ssab + sibling PNG), not the embedded
# variant, to exercise real texture-path resolution.
mkdir -p "$TYRANO_SSDATA/Ringo"
cp "$PIXI_PUBLIC/Ringo/Ringo.ssab" "$PIXI_PUBLIC/Ringo/Ringo.png" "$TYRANO_SSDATA/Ringo/"

# rmmz-example (RPG Maker MZ): convert the test .sspj into the game's asset
# folder (nested under spritestudio/<project>/ at the PROJECT ROOT — outside
# img/, whose contents deployment's "Exclude unused files" prunes). The MZ
# plugin build artefacts are synced separately by the example itself
# (examples/rmmz-example: pnpm run sync:plugin), mirroring tyranoscript-example
# — deploy-examples only publishes converted test assets.
RMMZ_SS="$ROOT_DIR/examples/rmmz-example/SampleProject/spritestudio"
mkdir -p "$RMMZ_SS"
node packages/ssconverter-web/scripts/cli.js --stem-dir -o "$RMMZ_SS" SpriteStudio-SDK/tests/Ringo/Ringo.sspj

# rmmz-harness drives the REAL Layer-3 renderer against a real PixiJS v5 context
# with only the MZ globals stubbed, so it needs the REFERENCE Ringo: its stubbed
# ImageManager loads the sibling PNG by URL, exactly as the real one does. It was
# missing from this script, so the harness fetched an .ssab that 404ed, handed
# the dev server's HTML to the runtime and trapped in wasm.
HARNESS_PUBLIC="$ROOT_DIR/examples/rmmz-harness/public"
mkdir -p "$HARNESS_PUBLIC/Ringo"
cp "$PIXI_PUBLIC/Ringo/Ringo.ssab" "$PIXI_PUBLIC/Ringo/Ringo.png" "$HARNESS_PUBLIC/Ringo/"

# part-follow: the part-tracking demo runs on Ringo alone, using the REFERENCE
# Ringo (ssab + sibling PNG, as main.ts loads it). Ringo has bone-skinned parts,
# which the demo's follow-target picker dims to steer away from tracking them.
PARTFOLLOW_PUBLIC="$ROOT_DIR/examples/part-follow/public"
mkdir -p "$PARTFOLLOW_PUBLIC/Ringo"
cp "$PIXI_PUBLIC/Ringo/Ringo.ssab" "$PIXI_PUBLIC/Ringo/Ringo.png" "$PARTFOLLOW_PUBLIC/Ringo/"

# sspj-preview: converts whatever the reader drops, so the only asset it needs
# is the one it opens on before they have dropped anything — the REFERENCE
# Ringo, loaded by URL like any other bundled pack.
PREVIEW_PUBLIC="$ROOT_DIR/examples/sspj-preview/public"
mkdir -p "$PREVIEW_PUBLIC/Ringo"
cp "$PIXI_PUBLIC/Ringo/Ringo.ssab" "$PIXI_PUBLIC/Ringo/Ringo.png" "$PREVIEW_PUBLIC/Ringo/"

echo "Deploy complete! Assets copied to examples/pixi-example/public, examples/webgl-example/public, examples/override-example/public, examples/tyranoscript-example/data/others/ssdata, examples/rmmz-example/SampleProject/spritestudio, examples/rmmz-harness/public, examples/part-follow/public and examples/sspj-preview/public."
