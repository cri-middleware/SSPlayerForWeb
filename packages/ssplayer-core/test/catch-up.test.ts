import { existsSync, readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { initializeWasm } from '../src/SSRuntimeManager.js';
import { DirectInternalPlayer } from '../src/DirectInternalPlayer.js';
import { CONVERTER_WASM, RUNTIME_WASM, convert, effectQuads, sdkProject, textures } from './real-runtime.js';

// A player switched before its pack's assets are in loads them in the
// background, and sets its instances up again once the instance packs have
// arrived. That catch-up must leave the effects alone: they play the pack's
// own effect data, which was there from the bind. Torn down with the instances,
// a player played before its load finished draws no particles until the next play().
//
// Boots the real runtime, since what is drawn is the runtime's to say. Plays
// the SDK's overall/Effect, converted here, and is skipped without the
// converter WASM, the runtime WASM or the SDK submodule.

const OVERALL = sdkProject('overall');

describe.skipIf(!existsSync(RUNTIME_WASM) || !existsSync(CONVERTER_WASM) || !existsSync(OVERALL))(
    'a player switched before its assets are in',
    () => {
        it('draws the effects a player switched after its load draws', async () => {
            await initializeWasm(readFileSync(RUNTIME_WASM));
            const pack = (await convert(OVERALL)).get('Effect.ssab')!;

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
