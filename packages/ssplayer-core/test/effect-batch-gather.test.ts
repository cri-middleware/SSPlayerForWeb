import { existsSync, readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { initializeWasm } from '../src/SSRuntimeManager.js';
import { DirectInternalPlayer } from '../src/DirectInternalPlayer.js';
import { EffectBatchPlanner } from '../src/EffectBatchPlanner.js';
import { DrawBatchKind } from '../src/ss/runtime/draw-batch-kind.js';
import { CONVERTER_WASM, RUNTIME_WASM, convert, sdkProject, textures } from './real-runtime.js';

// The Brain gives every effect part a batch of its own, so the renderers gather
// the effect batches that follow one another into one list, and neighbouring
// commands on one cell map and blend merge across effect parts. Gathering with
// `append` has to give the commands each batch gives on its own, in draw order.
// The SDK's Effect fixture draws its effect parts back to back, on shared cell
// maps.

const OVERALL = sdkProject('overall');

describe.skipIf(!existsSync(RUNTIME_WASM) || !existsSync(CONVERTER_WASM) || !existsSync(OVERALL))(
    'gathering consecutive effect batches',
    () => {
        it('keeps every batch\'s commands in draw order, and merges commands across parts', async () => {
            await initializeWasm(readFileSync(RUNTIME_WASM));
            const pack = (await convert(OVERALL)).get('Effect.ssab')!;

            const player = new DirectInternalPlayer(textures);
            player.bindResource(pack);
            await player.prepareResources();
            player.setAnimation('anime_1');
            player.play();

            const gathered = new EffectBatchPlanner<DirectInternalPlayer>();
            const single = new EffectBatchPlanner<DirectInternalPlayer>();
            const deltaMs = 1000 / player.getFrameRate();
            let runsAcrossParts = 0;
            for (let tick = 0; tick < 60; tick++) {
                player.update(deltaMs);
                const frameData = player.runtimeManager.getFrameData(player.getDrawFrame())!;
                const order = frameData.drawOrderArray()!;

                const expected: number[][] = [];
                let batches = 0;
                for (let b = 0; b < frameData.drawBatchesLength(); b++) {
                    const batch = frameData.drawBatches(b)!;
                    expect(batch.kind()).toBe(DrawBatchKind.Effect);
                    gathered.collect(player, frameData, order, batch.startRank(), batch.count(), batches > 0);
                    single.collect(player, frameData, order, batch.startRank(), batch.count());
                    for (let k = 0; k < single.count; k++) {
                        const d = single.items[k];
                        expected.push([d.partIdx, d.particleOffset, d.quadCount]);
                    }
                    batches++;
                }
                const got = gathered.items.slice(0, batches > 0 ? gathered.count : 0)
                    .map(d => [d.partIdx, d.particleOffset, d.quadCount]);
                expect(got).toEqual(expected);

                for (let g = 0; g < got.length; g = gathered.runEnd(g)) {
                    if (gathered.items[gathered.runEnd(g) - 1].partIdx !== gathered.items[g].partIdx) runsAcrossParts++;
                }
            }
            expect(runsAcrossParts).toBeGreaterThan(0);
        });
    },
);
