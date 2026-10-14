import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import * as nodePath from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { convertProject, init as initConverter } from '@spritestudio/ssconverter-core';
import { initializeWasm } from '../src/SSRuntimeManager.js';
import { DirectInternalPlayer } from '../src/DirectInternalPlayer.js';
import { DrawBatchKind } from '../src/ss/runtime/draw-batch-kind.js';
import type { IResourceManager } from '../src/IResourceManager.js';

// A player switched before its pack's assets are in loads them in the
// background, and sets its instances up again once the instance packs have
// arrived. That catch-up must leave the effects alone: they play the pack's
// own effect data, which was there from the bind. It used to tear them down
// with the instances and build nothing in their place, so a player played
// before its load finished drew no particles until the next play().
//
// Boots the real runtime, since what is drawn is the runtime's to say. Plays
// the SDK's overall/Effect, converted here, and is skipped without the
// converter WASM, the runtime WASM or the SDK submodule.

const here = nodePath.dirname(fileURLToPath(import.meta.url));
const repoRoot = nodePath.resolve(here, '../../..');
const RUNTIME_WASM = nodePath.join(repoRoot, 'packages/ssplayer-core/wasm/ssruntime_bg.wasm');
const CONVERTER_WASM = nodePath.join(repoRoot, 'packages/ssconverter-core/wasm/ssconverter_bg.wasm');
const PROJECT = nodePath.join(repoRoot, 'SpriteStudio-SDK/tests/overall');

function projectFiles(dir: string, prefix: string, into: Map<string, Uint8Array>): Map<string, Uint8Array> {
    for (const name of readdirSync(dir)) {
        const full = nodePath.join(dir, name);
        if (statSync(full).isDirectory()) projectFiles(full, `${prefix}/${name}`, into);
        else into.set(`${prefix}/${name}`, new Uint8Array(readFileSync(full)));
    }
    return into;
}

async function effectPack(): Promise<Uint8Array> {
    await initConverter(readFileSync(CONVERTER_WASM));
    const result = convertProject(projectFiles(PROJECT, 'overall', new Map()));
    try {
        return (result.output as Map<string, Uint8Array>).get('Effect.ssab')!;
    } finally {
        result.free();
    }
}

const textures: IResourceManager = {
    loadTexture: async () => {},
    getTexture: () => null,
    destroy: () => {},
};

/** The particles a renderer would draw this tick: the quads of every effect plan in the frame. */
function effectQuads(player: DirectInternalPlayer): number {
    const frameData = player.runtimeManager.getFrameData(player.getDrawFrame());
    if (!frameData) return 0;
    const order = frameData.drawOrderArray()!;
    let quads = 0;
    for (let b = 0; b < frameData.drawBatchesLength(); b++) {
        const batch = frameData.drawBatches(b)!;
        if (batch.kind() !== DrawBatchKind.Effect) continue;
        for (let c = 0; c < batch.count(); c++) {
            const plan = player.getEffectDrawPlan(order[batch.startRank() + c]);
            for (let k = 0; plan && k < plan.commandsLength(); k++) quads += plan.commands(k)!.quadCount();
        }
    }
    return quads;
}

describe.skipIf(!existsSync(RUNTIME_WASM) || !existsSync(CONVERTER_WASM) || !existsSync(PROJECT))(
    'a player switched before its assets are in',
    () => {
        it('draws the effects a player switched after its load draws', async () => {
            await initializeWasm(readFileSync(RUNTIME_WASM));
            const pack = await effectPack();

            const prepared = new DirectInternalPlayer(textures);
            prepared.bindResource(pack);
            await prepared.prepareResources();
            prepared.setAnimation('anime_1');
            prepared.play();

            const caughtUp = new DirectInternalPlayer(textures);
            caughtUp.bindResource(pack);
            caughtUp.setAnimation('anime_1'); // loads the assets in the background
            caughtUp.play();
            await caughtUp.prepareResources(); // the load the switch started
            // The catch-up runs once that load has settled.
            await new Promise(resolve => setTimeout(resolve, 0));

            const deltaMs = 1000 / prepared.getFrameRate();
            let quads = 0;
            for (let tick = 0; tick < 120; tick++) {
                prepared.update(deltaMs);
                caughtUp.update(deltaMs);
                const expected = effectQuads(prepared);
                expect(effectQuads(caughtUp), `tick ${tick}`).toBe(expected);
                quads += expected;
            }
            // Two players drawing no particle would pass the comparison above.
            expect(quads).toBeGreaterThan(0);

            prepared.destroy();
            caughtUp.destroy();
        }, 60_000);
    },
);
