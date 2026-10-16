import { existsSync, readFileSync } from 'node:fs';
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { initializeWasm, SSRuntimeContext } from '../src/SSRuntimeManager.js';
import { DirectInternalPlayer } from '../src/DirectInternalPlayer.js';
import { CONVERTER_WASM, RUNTIME_WASM, convert, effectQuads, sdkProject, textures } from './real-runtime.js';

// The runtime evaluates a frame only when what it evaluates to may have
// changed: a player that stands still, stopped or paused, draws its frame every
// tick from what the last evaluation built. What is pinned:
//
//  - a stopped player, and a paused one still ticking, evaluate once;
//  - a playing player evaluates every tick, even one that draws the same frame;
//  - a write to the runtime while stopped is evaluated, so it shows;
//  - what is handed out is always what an evaluation would build, effects
//    included, through playing, pausing, resuming and stopping.
//
// Boots the real runtime and plays the SDK's Ringo and overall/Effect,
// converted here. Skipped without the converter WASM, the runtime WASM or the
// SDK submodule.

const RINGO = sdkProject('Ringo');
const OVERALL = sdkProject('overall');

const TICK = 1000 / 60;

describe.skipIf(!existsSync(RUNTIME_WASM) || !existsSync(CONVERTER_WASM) || !existsSync(RINGO) || !existsSync(OVERALL))(
    'frame evaluation',
    () => {
        let ringo: Uint8Array;
        let effect: Uint8Array;

        beforeAll(async () => {
            await initializeWasm(readFileSync(RUNTIME_WASM));
            ringo = (await convert(RINGO)).get('Ringo.ssab')!;
            effect = (await convert(OVERALL)).get('Effect.ssab')!;
        }, 120_000);

        afterEach(() => {
            vi.restoreAllMocks();
        });

        async function playerOf(pack: Uint8Array, animation: string): Promise<DirectInternalPlayer> {
            const player = new DirectInternalPlayer(textures);
            player.bindResource(pack);
            await player.prepareResources();
            player.setAnimation(animation);
            return player;
        }

        /** The bytes a draw of `player`'s frame reads, copied out. */
        function drawnBytes(player: DirectInternalPlayer): Uint8Array {
            const frameData = player.runtimeManager.getFrameData(player.getDrawFrame())!;
            return frameData.bb!.bytes().slice();
        }

        const evaluations = () => vi.spyOn(SSRuntimeContext.prototype, 'prepare_frame_data');

        it('a stopped player evaluates its frame once', async () => {
            const player = await playerOf(ringo, 'walk');
            const spy = evaluations();
            for (let i = 0; i < 5; i++) drawnBytes(player);
            expect(spy).toHaveBeenCalledTimes(1);
            player.destroy();
        });

        it('a paused player evaluates its frame once, ticking', async () => {
            const player = await playerOf(ringo, 'walk');
            player.play();
            for (let i = 0; i < 10; i++) player.update(TICK);
            player.pause();
            const spy = evaluations();
            for (let i = 0; i < 10; i++) {
                player.update(TICK);
                drawnBytes(player);
            }
            expect(spy).toHaveBeenCalledTimes(1);
            player.destroy();
        });

        it('a playing player evaluates every tick, even one that draws the same frame', async () => {
            const player = await playerOf(ringo, 'walk');
            player.subFrameEnabled = false;
            player.play();
            const spy = evaluations();
            const frames = new Set<number>();
            for (let i = 0; i < 10; i++) {
                player.update(TICK / 4);
                frames.add(player.getDrawFrame());
                drawnBytes(player);
            }
            // Quarter ticks: most of them draw the frame the last one drew.
            expect(frames.size).toBeLessThan(10);
            expect(spy).toHaveBeenCalledTimes(10);
            player.destroy();
        });

        it('a write while stopped is evaluated, so it shows', async () => {
            const player = await playerOf(ringo, 'walk');
            const before = drawnBytes(player);
            const spy = evaluations();
            expect(player.setPartVisibilityOverride(player.runtimeManager.getPartName(1)!, true)).toBe(true);
            const after = drawnBytes(player);
            expect(spy).toHaveBeenCalledTimes(1);
            expect(after).not.toEqual(before);
            player.runtimeManager.invalidateFrame();
            expect(drawnBytes(player)).toEqual(after);
            player.destroy();
        });

        it('hands out what an evaluation builds, effects included, through play, pause, resume and stop', async () => {
            const kept = await playerOf(effect, 'anime_1');
            const fresh = await playerOf(effect, 'anime_1');
            const both = (f: (p: DirectInternalPlayer) => void) => { f(kept); f(fresh); };
            const steps: [string, (p: DirectInternalPlayer) => void, number][] = [
                ['play', p => p.play(), 40],
                ['pause', p => p.pause(), 20],
                ['resume', p => p.resume(), 20],
                ['stop', p => p.stop(), 10],
                ['seek', p => p.setFrameNo(5), 10],
            ];
            let quads = 0;
            for (const [name, step, ticks] of steps) {
                both(step);
                for (let tick = 0; tick < ticks; tick++) {
                    both(p => p.update(TICK));
                    fresh.runtimeManager.invalidateFrame();
                    const expected = effectQuads(fresh);
                    expect(effectQuads(kept), `${name} tick ${tick}`).toBe(expected);
                    fresh.runtimeManager.invalidateFrame();
                    expect(drawnBytes(kept), `${name} tick ${tick}`).toEqual(drawnBytes(fresh));
                    quads += expected;
                }
            }
            // Two players drawing no particle would pass the comparison above.
            expect(quads).toBeGreaterThan(0);
            kept.destroy();
            fresh.destroy();
        }, 60_000);
    },
);
