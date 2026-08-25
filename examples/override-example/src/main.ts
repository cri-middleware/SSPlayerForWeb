// Override Layer API demo — the Web counterpart of SSPlayerForGodot's and
// SSPlayerForUnity's examples/Override_Ringo.
//
// The Ringo animation keeps playing while the demo cycles through the three
// per-part runtime overrides. Each one wins over the keyframed animation
// underneath, which is the whole point: a script can say "make this part this
// colour / this cell / hidden NOW" without fighting the animation.
//
// API used (all on SSPlayer; the same methods exist on the WebGL and RMMZ
// players, and on the core InternalPlayerBase underneath them):
//   findPartIndex(partName)
//   setPartColorOverride(part, blendOp, rgba, priority = HoldUntilNextAnimation)
//   setPartVisibilityOverride(part, hide, cascade = false)
//   setPartCellOverride(part, cellmapName, cellName, priority = HoldUntilNextAnimation)
//   clearAllPartOverrides()
// Cell targets can be discovered from the player: getCellmapNames() / getCellNames(cellmap).

import { Application } from 'pixi.js';
import { SSPlayer, SSBlendOp } from '@spritestudio/ssplayer-pixi';

/** Part the demo overrides — 'apple' is Ringo's body. */
const PART_NAME = 'apple';
/** Second part, hidden on its own to show a force-hide that does not cascade. */
const SECOND_PART_NAME = 'heta';
/** Cell the cell-override step swaps in (must exist in the first cell map). */
const CELL_NAME = 'effect3';

/**
 * Colour for the colour-override step: `0xRRGGBBAA`, the packing the runtime
 * itself takes. This is rgba(0, 51, 255, 191) — the same translucent blue the
 * Godot and Unity demos use. It is interpreted in 8-bit sRGB exactly like an
 * authored PartColor, and the runtime pre-multiplies the alpha with the part's
 * composed alpha, so it must NOT be pre-multiplied here.
 */
const OVERRIDE_COLOR = 0x0033ffbf;

const stepEl = document.getElementById('step') as HTMLDivElement;
const callEl = document.getElementById('call') as HTMLDivElement;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Show a demo step and hold it long enough to read. */
async function step(text: string, call: string, seconds: number) {
    stepEl.textContent = text;
    callEl.textContent = call;
    console.log(`[Override Demo] ${text}`);
    await sleep(seconds * 1000);
}

function fail(message: string) {
    stepEl.textContent = message;
    callEl.textContent = '';
    console.warn(`[Override Demo] ${message}`);
}

async function main() {
    await SSPlayer.initialize();

    const app = new Application();
    await app.init({ width: 1280, height: 960, backgroundColor: 0x1a1a2e, preference: 'webgpu' });

    const container = document.getElementById('canvas-container');
    if (container) {
        container.insertBefore(app.canvas, container.firstChild);
    } else {
        document.body.appendChild(app.canvas);
    }

    // The deploy nests each SS project's output under public/<project>/
    // (ssconverter `--stem-dir`), so Ringo's assets live in Ringo/. Resolved
    // against the page so this works both at the dev-server root and under the
    // /examples/override/ subpath the Pages build is served from.
    const player = new SSPlayer();
    await player.load(new URL('Ringo/Ringo.ssab', document.baseURI).href);
    player.setAnimation('run');
    // Horizontally centred, 250px below centre: Ringo's origin sits near its feet,
    // so centring outright leaves it high in the frame. Same offset the Godot demo
    // applies (viewport centre + (0, 250)).
    player.position.set(640, 730);
    app.stage.addChild(player);

    // Keep the animation playing: an override is easiest to read while the
    // animation underneath keeps advancing (it also shows the override winning
    // over the keyframes rather than merely filling a gap).
    player.play();

    void runDemo(player);
}

async function runDemo(player: SSPlayer) {
    // Discover what the loaded SSAB offers. Handy as a reference in the console,
    // and the cell override needs a cell-map name to address a cell by.
    const cellmaps = player.getCellmapNames();
    if (cellmaps.length === 0) {
        fail('No cell map in the loaded SSAB — nothing to demo.');
        return;
    }
    const cellmap = cellmaps[0]; // "Ringo"
    console.log(`[Override Demo] cellmap: ${cellmap} / cells: ${player.getCellNames(cellmap).join(', ')}`);

    // The same part is overridden over and over, so resolve its index once and
    // reuse it: indices are stable within one SSAB, and addressing by index
    // skips the name lookup. Every method also accepts the name directly, as
    // the 'heta' steps below show.
    const partIndex = player.findPartIndex(PART_NAME);
    if (partIndex < 0) {
        fail(`Part '${PART_NAME}' is not in this animation.`);
        return;
    }

    for (;;) {
        player.clearAllPartOverrides();
        await step('Ringo Override Demo — no overrides', 'player.clearAllPartOverrides()', 1.5);

        // 1) Colour — tint the body (Normal parts only). The default priority
        //    (HoldUntilNextAnimation) keeps it through animation loops.
        player.setPartColorOverride(partIndex, SSBlendOp.Mix, OVERRIDE_COLOR);
        await step(
            '1) Color override:  body -> blue',
            `player.setPartColorOverride(${partIndex}, SSBlendOp.Mix, 0x${OVERRIDE_COLOR.toString(16).padStart(8, '0')})`,
            2,
        );

        // 2) Visibility — force-hide. `cascade` would take the descendants with
        //    it; here the second part is hidden on its own instead, to show the
        //    non-cascading form. Visibility has no priority mode.
        player.clearAllPartOverrides();
        player.setPartVisibilityOverride(partIndex, true, false);
        player.setPartVisibilityOverride(SECOND_PART_NAME, true, false);
        await step(
            `2) Visibility override:  hide '${PART_NAME}' and '${SECOND_PART_NAME}'`,
            `player.setPartVisibilityOverride(${partIndex}, true, false)\n` +
            `player.setPartVisibilityOverride('${SECOND_PART_NAME}', true, false)`,
            2,
        );

        // 3) Cell — swap the body's sprite for a different cell in the same cell
        //    map. The names are resolved here, once, not per frame.
        player.clearAllPartOverrides();
        player.setPartCellOverride(partIndex, cellmap, CELL_NAME);
        player.setPartVisibilityOverride(SECOND_PART_NAME, true, false);
        await step(
            `3) Cell override:  body sprite -> '${CELL_NAME}' cell`,
            `player.setPartCellOverride(${partIndex}, '${cellmap}', '${CELL_NAME}')`,
            2,
        );

        player.clearAllPartOverrides();
        await step('4) No override (restored)', 'player.clearAllPartOverrides()', 2);
    }
}

main().catch((e) => {
    fail(`Failed to start: ${e instanceof Error ? e.message : String(e)}`);
    console.error(e);
});
