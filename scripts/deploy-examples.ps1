$ErrorActionPreference = "Stop"

$HelpApp = Split-Path -Leaf $PSCommandPath
function Show-Usage {
    Write-Host "Usage: ${HelpApp} [--help]"
    Write-Host "  Compile the SDK's bundled test projects into the examples' asset directories,"
    Write-Host "  both reference and embedded. Needs node and the built ssconverter-web package."
}

foreach ($arg in $args) {
    switch -Regex ($arg) {
        '^(-h|--help|help)$' { Show-Usage; exit 0 }
        default {
            [Console]::Error.WriteLine("${HelpApp}: unknown argument '$arg'")
            Show-Usage
            exit 2
        }
    }
}

$ROOT_DIR = (Resolve-Path "$PSScriptRoot\..").Path
$PIXI_PUBLIC = Join-Path $ROOT_DIR "examples\pixi-example\public"
$WEBGL_PUBLIC = Join-Path $ROOT_DIR "examples\webgl-example\public"
# override-example only ever plays Ringo, so it takes just that project's output.
$OVERRIDE_PUBLIC = Join-Path $ROOT_DIR "examples\override-example\public"
# TyranoScript serves assets from data/others/ssdata (see tyranoscript-example README).
$TYRANO_SSDATA = Join-Path $ROOT_DIR "examples\tyranoscript-example\data\others\ssdata"

if (!(Test-Path -Path $PIXI_PUBLIC)) {
    New-Item -ItemType Directory -Force -Path $PIXI_PUBLIC | Out-Null
}
if (!(Test-Path -Path $WEBGL_PUBLIC)) {
    New-Item -ItemType Directory -Force -Path $WEBGL_PUBLIC | Out-Null
}
if (!(Test-Path -Path $TYRANO_SSDATA)) {
    New-Item -ItemType Directory -Force -Path $TYRANO_SSDATA | Out-Null
}

Write-Host "Compiling SpriteStudio test assets..."
Set-Location -Path $ROOT_DIR

# --stem-dir nests each project's output under <out>/<sspj-stem>/, so overall's
# many ssab land in <out>/overall/ and Ringo's in <out>/Ringo/.
node packages/ssconverter-web/scripts/cli.js --stem-dir -o "$PIXI_PUBLIC" SpriteStudio-SDK/tests/overall/overall.sspj
node packages/ssconverter-web/scripts/cli.js --stem-dir -o "$PIXI_PUBLIC" SpriteStudio-SDK/tests/Ringo/Ringo.sspj
node packages/ssconverter-web/scripts/cli.js --stem-dir -o "$PIXI_PUBLIC" SpriteStudio-SDK/tests/Doll/Doll.sspj

# Also emit embedded-texture variants (*_embedded.ssab) so the examples can demo
# SSABs whose textures are inlined (no sibling image files needed).
Write-Host "Compiling embedded-texture variants..."
node packages/ssconverter-web/scripts/cli.js --stem-dir --embedded --suffix _embedded -o "$PIXI_PUBLIC" SpriteStudio-SDK/tests/overall/overall.sspj
node packages/ssconverter-web/scripts/cli.js --stem-dir --embedded --suffix _embedded -o "$PIXI_PUBLIC" SpriteStudio-SDK/tests/Ringo/Ringo.sspj
node packages/ssconverter-web/scripts/cli.js --stem-dir --embedded --suffix _embedded -o "$PIXI_PUBLIC" SpriteStudio-SDK/tests/Doll/Doll.sspj

Copy-Item -Path "$PIXI_PUBLIC\*" -Destination $WEBGL_PUBLIC -Recurse -Force

# override-example: the Override Layer demo runs on Ringo alone (reference
# textures, so the sibling PNG comes along).
$OVERRIDE_RINGO = Join-Path $OVERRIDE_PUBLIC "Ringo"
New-Item -ItemType Directory -Force -Path $OVERRIDE_RINGO | Out-Null
Copy-Item -Path (Join-Path $PIXI_PUBLIC "Ringo\*") -Destination $OVERRIDE_RINGO -Recurse -Force

# tyranoscript-example uses the REFERENCE Ringo (ssab + sibling PNG), not the embedded
# variant, to exercise real texture-path resolution.
$TYRANO_RINGO = Join-Path $TYRANO_SSDATA "Ringo"
New-Item -ItemType Directory -Force -Path $TYRANO_RINGO | Out-Null
Copy-Item -Path (Join-Path $PIXI_PUBLIC "Ringo\Ringo.ssab"), (Join-Path $PIXI_PUBLIC "Ringo\Ringo.png") -Destination $TYRANO_RINGO -Force

# rmmz-example (RPG Maker MZ): convert the test .sspj into the game's asset
# folder (nested under spritestudio\<project>\ at the PROJECT ROOT — outside
# img\, whose contents deployment's "Exclude unused files" prunes). The MZ
# plugin build artefacts are synced separately by the example itself
# (examples/rmmz-example: pnpm run sync:plugin), mirroring tyranoscript-example
# — deploy-examples only publishes converted test assets.
$RMMZ_SS = Join-Path $ROOT_DIR "examples\rmmz-example\SampleProject\spritestudio"
New-Item -ItemType Directory -Force -Path $RMMZ_SS | Out-Null
node packages/ssconverter-web/scripts/cli.js --stem-dir -o "$RMMZ_SS" SpriteStudio-SDK/tests/Ringo/Ringo.sspj

# rmmz-harness drives the REAL Layer-3 renderer against a real PixiJS v5 context
# with only the MZ globals stubbed, so it needs the REFERENCE Ringo: its stubbed
# ImageManager loads the sibling PNG by URL, exactly as the real one does. It was
# missing from this script, so the harness fetched an .ssab that 404ed, handed
# the dev server's HTML to the runtime and trapped in wasm.
$HARNESS_RINGO = Join-Path $ROOT_DIR "examples\rmmz-harness\public\Ringo"
New-Item -ItemType Directory -Force -Path $HARNESS_RINGO | Out-Null
Copy-Item -Path (Join-Path $PIXI_PUBLIC "Ringo\Ringo.ssab"), (Join-Path $PIXI_PUBLIC "Ringo\Ringo.png") -Destination $HARNESS_RINGO -Force

# part-follow: the part-tracking demo runs on Ringo alone, using the REFERENCE
# Ringo (ssab + sibling PNG, as main.ts loads it). Ringo has bone-skinned parts,
# which the demo's follow-target picker dims to steer away from tracking them.
$PARTFOLLOW_RINGO = Join-Path $ROOT_DIR "examples\part-follow\public\Ringo"
New-Item -ItemType Directory -Force -Path $PARTFOLLOW_RINGO | Out-Null
Copy-Item -Path (Join-Path $PIXI_PUBLIC "Ringo\Ringo.ssab"), (Join-Path $PIXI_PUBLIC "Ringo\Ringo.png") -Destination $PARTFOLLOW_RINGO -Force

Write-Host "Deploy complete! Assets copied to $PIXI_PUBLIC, $WEBGL_PUBLIC, $OVERRIDE_PUBLIC, $TYRANO_SSDATA, $RMMZ_SS, $HARNESS_RINGO and $PARTFOLLOW_RINGO."
