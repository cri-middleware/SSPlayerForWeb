import { existsSync, readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { initializeWasm } from '../src/SSRuntimeManager.js';
import { DirectInternalPlayer } from '../src/DirectInternalPlayer.js';
import { SSOverridePriority } from '../src/PartOverride.js';
import { CONVERTER_WASM, RUNTIME_WASM, convert, sdkProject, textures } from './real-runtime.js';

// isPartHidden reads the part's `hide` from the frame last evaluated, the one
// the renderer draws, and the runtime writes a visibility override and its
// cascade into that `hide`. So the answer includes a force-hide from the next
// frame evaluated, and setPartVisibilityOverride(part, false) only reverts to
// the animation: it does not show a part the animation hides. A read evaluates
// nothing, so it cannot change what the next update builds.
//
// Boots the real runtime, since which hide the frame carries is the runtime's
// to say. Plays the SDK's Doll and Ringo, converted here: Doll's
// Action01_Body/Wait keys its effect part hidden, and Ringo keys apple's cell
// at frame 0. Skipped without the converter WASM, the runtime WASM or the SDK
// submodule.

const PROJECT = sdkProject('Doll');
const RINGO = sdkProject('Ringo');

describe.skipIf(!existsSync(RUNTIME_WASM) || !existsSync(CONVERTER_WASM) || !existsSync(PROJECT) || !existsSync(RINGO))(
    'isPartHidden',
    () => {
        it('reports a visibility override and its cascade from the next frame evaluated, and false only reverts', async () => {
            await initializeWasm(readFileSync(RUNTIME_WASM));
            const packs = await convert(PROJECT);
            const player = new DirectInternalPlayer(textures);
            player.setInstancePackProvider(name => packs.get(`${name}.ssab`));
            player.bindResource(packs.get('Action01_Body.ssab')!);
            await player.prepareResources();
            player.setAnimation('Wait');
            player.play();
            player.update(100);

            // `Body` descends from `root`; Wait keys `effect_1` hidden.
            const hidden = () => [player.isPartHidden('root'), player.isPartHidden('Body'), player.isPartHidden('effect_1')];
            // What a renderer does after an update: evaluate the frame it draws.
            const evaluated = () => {
                player.evaluateDrawFrame();
                return hidden();
            };
            expect(evaluated()).toEqual([false, false, true]);

            // The override waits for the next frame evaluated, however often it
            // is read before then.
            player.setPartVisibilityOverride('root', true);
            expect(hidden()).toEqual([false, false, true]);
            expect(hidden()).toEqual([false, false, true]);
            expect(evaluated()).toEqual([true, false, true]);
            player.setPartVisibilityOverride('root', true, true);
            expect(evaluated()).toEqual([true, true, true]);

            player.setPartVisibilityOverride('root', false);
            expect(evaluated()).toEqual([false, false, true]);
            // There is no force-show: the animation's own hide stands.
            player.setPartVisibilityOverride('effect_1', false);
            expect(evaluated()).toEqual([false, false, true]);

            player.setPartVisibilityOverride('Body', true);
            expect(evaluated()).toEqual([false, true, true]);
            player.clearPartVisibilityOverride('Body');
            expect(evaluated()).toEqual([false, false, true]);

            player.destroy();
        }, 60_000);

        it('keeps an OverwriteOnNextKeyframe override set after play when read before the first update', async () => {
            // The first update after play passes frame 0, where apple's cell is
            // keyed. An override set there holds only if that update is the
            // first to evaluate it, so a read that evaluated before the update
            // would hand it back to the animation.
            await initializeWasm(readFileSync(RUNTIME_WASM));
            const ringo = (await convert(RINGO)).get('Ringo.ssab')!;
            const firstFrameUvs = async (read: boolean, override = true) => {
                const player = new DirectInternalPlayer(textures);
                player.bindResource(ringo);
                await player.prepareResources();
                player.setAnimation(player.animationNames[0]);
                player.play();
                if (override) {
                    expect(player.setPartCellOverride('apple', 'Ringo', 'effect3', SSOverridePriority.OverwriteOnNextKeyframe)).toBe(true);
                }
                if (read) player.isPartHidden('apple');
                player.update(16);
                player.evaluateDrawFrame();
                const apple = player.findPartIndex('apple');
                const uvs = Array.from(player.runtimeManager.getLocalUVs().subarray(apple * 10, apple * 10 + 10));
                player.destroy();
                return uvs;
            };

            const unread = await firstFrameUvs(false);
            // The override must actually take, or the test proves nothing.
            expect(await firstFrameUvs(false, false)).not.toEqual(unread);
            expect(await firstFrameUvs(true)).toEqual(unread);
        }, 60_000);
    },
);
