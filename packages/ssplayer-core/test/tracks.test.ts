import { existsSync, readFileSync } from 'node:fs';
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { initializeWasm } from '../src/SSRuntimeManager.js';
import { DirectInternalPlayer } from '../src/DirectInternalPlayer.js';
import { SSTrackBlend, SSTrackSync } from '../src/Tracks.js';
import { CONVERTER_WASM, RUNTIME_WASM, convert, sdkProject, textures } from './real-runtime.js';

// The player layer over the runtime's track stack. What the runtime does with a
// track is the runtime's, and its own suite holds it; this one holds what the
// player adds on top and what it can get wrong:
//
//  - track 0 changes hands at the call, on all three paths (setAnimation, and
//    setTrackAnimation / crossfade on track 0), so `currentAnimation`, the
//    same-name guard, the canvas and the per-animation reads follow it there;
//  - the host's loop count goes back on after each of them;
//  - the clock keeps running after track 0 ends, as long as there is another
//    track or a fade to run, and a stop stops it;
//  - an event is read from the table of the animation that fired it.
//
// Boots the real runtime and plays the SDK's Ringo and overall/UserData,
// converted here. Ringo's `attack1` is short (20 frames), `walk` long, and only
// `dead` has a wider canvas. Skipped without the converter WASM, the runtime
// WASM or the SDK submodule.

const RINGO = sdkProject('Ringo');
const OVERALL = sdkProject('overall');

const TICK = 1000 / 60;

describe.skipIf(!existsSync(RUNTIME_WASM) || !existsSync(CONVERTER_WASM) || !existsSync(RINGO) || !existsSync(OVERALL))(
    'tracks',
    () => {
        let ringo: Uint8Array;
        let userData: Uint8Array;

        beforeAll(async () => {
            await initializeWasm(readFileSync(RUNTIME_WASM));
            ringo = (await convert(RINGO)).get('Ringo.ssab')!;
            userData = (await convert(OVERALL)).get('UserData.ssab')!;
        }, 120_000);

        async function ringoPlayer(animation = 'walk'): Promise<DirectInternalPlayer> {
            const player = new DirectInternalPlayer(textures);
            player.bindResource(ringo);
            await player.prepareResources();
            player.setAnimation(animation);
            return player;
        }

        function run(player: DirectInternalPlayer, ms: number): void {
            for (let t = 0; t < ms; t += TICK) player.update(TICK);
        }

        it('fixture sanity: Ringo has the animations this suite plays, and dead is wider', async () => {
            const player = await ringoPlayer();
            for (const name of ['walk', 'attack1', 'wait1', 'dead']) expect(player.animationNames).toContain(name);
            const walk = player.getCanvasRect()!.width;
            player.setAnimation('dead');
            expect(player.getCanvasRect()!.width).not.toBe(walk);
            player.destroy();
        });

        describe('track 0 changes hands at the call', () => {
            it('crossfade makes the incoming animation current at once, and setAnimation can switch back', async () => {
                const player = await ringoPlayer();
                player.play();
                const walkCanvas = player.getCanvasRect();
                player.crossfade(0, 'dead', 300);
                expect(player.currentAnimation).toBe('dead');
                // A name-keyed read follows it too: only `dead` is wider.
                expect(player.getCanvasRect()!.width).not.toBe(walkCanvas!.width);
                expect(player.runtimeManager.getCurrentAnimationData()!.name()).toBe('dead');

                // Naming the incoming one mid-fade changes nothing: the fade runs on.
                player.setAnimation('dead');
                expect(player.getTrackFadeProgress(0)).toBeDefined();

                // Naming the one it faded out from is a real switch back.
                player.setAnimation('walk');
                expect(player.currentAnimation).toBe('walk');
                expect(player.getTrackFadeProgress(0)).toBeUndefined();
                expect(player.getCanvasRect()!.width).toBe(walkCanvas!.width);
                player.destroy();
            });

            it('setTrackAnimation makes the animation current on track 0, and only there', async () => {
                const player = await ringoPlayer();
                player.setTrackAnimation(1, 'attack1');
                expect(player.currentAnimation).toBe('walk');
                player.setTrackAnimation(0, 'wait1');
                expect(player.currentAnimation).toBe('wait1');
                player.setAnimation('walk');
                expect(player.currentAnimation).toBe('walk');
                expect(player.trackCount).toBe(1);
                player.destroy();
            });

            it('keeps the speed and puts the loop count back across a crossfade and a track animation', async () => {
                const player = await ringoPlayer();
                player.setSpeedScale(2);
                player.setLoopCount(1);
                player.crossfade(0, 'wait1', 200);
                expect(player.getSpeedScale()).toBe(2);
                expect(player.getLoopCount()).toBe(1);
                player.setTrackAnimation(0, 'attack1');
                expect(player.getSpeedScale()).toBe(2);
                expect(player.getLoopCount()).toBe(1);
                // Written through the track, it is the count kept for track 0.
                player.setTrackLoopCount(0, 3);
                player.crossfade(0, 'walk', 200);
                expect(player.getLoopCount()).toBe(3);
                player.destroy();
            });
        });

        it('reads back the playback settings set before the first setAnimation', async () => {
            // The player keeps no copy of them, so a read is the runtime's
            // track 0 setting even before an animation is laid there.
            const player = new DirectInternalPlayer(textures);
            player.bindResource(ringo);
            await player.prepareResources();
            player.setSpeedScale(2);
            player.setFrameSkipEnabled(false);
            expect(player.getSpeedScale()).toBe(2);
            expect(player.isFrameSkipEnabled()).toBe(false);
            player.setAnimation('walk');
            expect(player.getSpeedScale()).toBe(2);
            expect(player.isFrameSkipEnabled()).toBe(false);
            player.destroy();
        });

        describe('track settings', () => {
            it('round-trip, and another animation on the track keeps the speed but loops forever again', async () => {
                const player = await ringoPlayer();
                player.setTrackAnimation(1, 'attack1');
                player.setTrackSpeed(1, 0.5);
                player.setTrackFrameRate(1, 30);
                player.setTrackFrameSkipEnabled(1, false);
                player.setTrackLoopCount(1, 2);
                player.setTrackAlpha(1, 0.4);
                player.setTrackBlend(1, SSTrackBlend.Additive);
                player.setTrackSync(1, SSTrackSync.Start);
                player.setTrackOutgoingEventThreshold(1, 0.5);
                expect(player.getTrackSpeed(1)).toBe(0.5);
                expect(player.getTrackFrameRate(1)).toBe(30);
                expect(player.getTrackFrameSkipEnabled(1)).toBe(false);
                expect(player.getTrackLoopCount(1)).toBe(2);
                expect(player.getTrackAlpha(1)).toBeCloseTo(0.4);
                expect(player.getTrackBlend(1)).toBe(SSTrackBlend.Additive);
                expect(player.getTrackSync(1)).toBe(SSTrackSync.Start);
                expect(player.getTrackOutgoingEventThreshold(1)).toBe(0.5);

                player.setTrackAnimation(1, 'wait1');
                expect(player.getTrackSpeed(1)).toBe(0.5);
                expect(player.getTrackLoopCount(1)).toBe(-1);
                player.destroy();
            });

            it('answers undefined for a track or source that is not there, and throws naming the call for a command', async () => {
                const player = await ringoPlayer();
                expect(player.getTrackAlpha(5)).toBeUndefined();
                expect(player.getTrackLoopCount(5)).toBeUndefined();
                expect(player.getTrackMainSource(5)).toBeUndefined();
                expect(player.getSourceWeight(9999)).toBeUndefined();
                expect(player.isTrackFinished(5)).toBe(false);
                expect(player.trackJustLooped(5)).toBe(false);
                expect(() => player.clearTrack(0)).toThrow(/clearTrack\(0\)/);
                expect(() => player.crossfade(0, 'nope', 100)).toThrow(/crossfade\(0, "nope", 100\)/);
                // A failed crossfade hands nothing over.
                expect(player.currentAnimation).toBe('walk');
                player.destroy();
            });
        });

        describe('time', () => {
            it('advances a fade to completion and releases the outgoing side', async () => {
                const player = await ringoPlayer();
                player.play();
                const outgoing = player.getTrackMainSource(0)!;
                player.crossfade(0, 'wait1', 200);
                const incoming = player.getTrackMainSource(0)!;
                expect(incoming).not.toBe(outgoing);
                run(player, 100);
                expect(player.getTrackFadeProgress(0)!).toBeGreaterThan(0);
                run(player, 200);
                expect(player.getTrackFadeProgress(0)).toBeUndefined();
                expect(player.getSourceWeight(outgoing)).toBeUndefined();
                expect(player.isPlaying).toBe(true);
                player.destroy();
            });

            it('plays the incoming animation at the speed track 0 was given', async () => {
                const advance = async (speed: number) => {
                    const player = await ringoPlayer();
                    player.setSpeedScale(speed);
                    player.play();
                    player.crossfade(0, 'wait1', 1000);
                    run(player, 200);
                    const frame = player.getFrameNo();
                    player.destroy();
                    return frame;
                };
                expect(await advance(2)).toBeCloseTo((await advance(1)) * 2, 0);
            });

            it('finishes once on the incoming animation\'s loop count, and not on the outgoing one running out', async () => {
                const player = await ringoPlayer('attack1');
                player.setLoopCount(1);
                player.play();
                // attack1 runs out mid-fade; the character does not finish with it.
                player.crossfade(0, 'walk', 1000);
                let edges = 0;
                for (let t = 0; t < 600; t += TICK) {
                    player.update(TICK);
                    if (player.pollPlaybackEvents().finished) edges++;
                }
                expect(player.isFinished).toBe(false);
                expect(edges).toBe(0);

                // walk carries the count of 1 and finishes on its own, exactly once.
                for (let t = 0; t < 3000; t += TICK) {
                    player.update(TICK);
                    if (player.pollPlaybackEvents().finished) edges++;
                }
                expect(player.isFinished).toBe(true);
                expect(edges).toBe(1);
                player.destroy();
            });

            it('holds a finished overlay on its last frame, reports its loop once, and not after a paused update', async () => {
                const player = await ringoPlayer();
                player.play();
                player.setTrackAnimation(1, 'attack1');
                player.setTrackLoopCount(1, 2);
                let loops = 0;
                for (let t = 0; t < 2000; t += TICK) {
                    player.update(TICK);
                    if (player.trackJustLooped(1)) loops++;
                }
                expect(loops).toBe(1);
                expect(player.isTrackFinished(1)).toBe(true);
                expect(player.isFinished).toBe(false);

                // A pulse read after an update that ran nothing is not news.
                player.setTrackAnimation(1, 'attack1');
                let looped = false;
                for (let t = 0; t < 500 && !looped; t += TICK) {
                    player.update(TICK);
                    looped = player.trackJustLooped(1);
                }
                expect(looped).toBe(true);
                player.pause();
                player.update(TICK);
                expect(player.trackJustLooped(1)).toBe(false);
                player.destroy();
            });

            it('keeps the overlays running after track 0 finishes, until stop', async () => {
                const player = await ringoPlayer('attack1');
                player.setLoopCount(1);
                player.play();
                player.setTrackAnimation(1, 'walk');
                run(player, 1000);
                expect(player.isFinished).toBe(true);
                expect(player.isPlaying).toBe(false);
                expect(player.isTicking).toBe(true);

                const before = player.getTrackFrame(1)!;
                run(player, 200);
                expect(player.getTrackFrame(1)!).toBeGreaterThan(before);

                player.stop();
                expect(player.isTicking).toBe(false);
                const stopped = player.getTrackFrame(1)!;
                run(player, 200);
                expect(player.getTrackFrame(1)).toBe(stopped);
                player.destroy();
            });

            it('holds the overlays on a pause after track 0 finishes, though isPausing reads false', async () => {
                const player = await ringoPlayer('attack1');
                player.setLoopCount(1);
                player.play();
                player.setTrackAnimation(1, 'walk');
                run(player, 1000);
                expect(player.isFinished).toBe(true);

                player.pause();
                expect(player.isPausing).toBe(false);
                expect(player.isHeld).toBe(true);
                expect(player.isTicking).toBe(true);
                const held = player.getTrackFrame(1)!;
                // A held player steps its independent slots and leaves the clock alone.
                const advance = vi.spyOn(player.runtimeManager, 'update');
                run(player, 200);
                expect(player.getTrackFrame(1)).toBe(held);
                expect(advance).not.toHaveBeenCalled();
                advance.mockRestore();

                player.resume();
                expect(player.isHeld).toBe(false);
                run(player, 200);
                expect(player.getTrackFrame(1)!).toBeGreaterThan(held);
                player.destroy();
            });

            it('keeps a source added to track 0 running after track 0 finishes', async () => {
                const player = await ringoPlayer('attack1');
                player.setLoopCount(1);
                player.play();
                const source = player.addTrackSource(0, 'walk', 1);
                run(player, 1000);
                expect(player.isFinished).toBe(true);
                expect(player.trackCount).toBe(1);
                expect(player.isTicking).toBe(true);

                const before = player.getSourceFrame(source)!;
                run(player, 200);
                expect(player.getSourceFrame(source)!).not.toBe(before);
                player.destroy();
            });

            it('stops ticking after track 0 finishes when the overlays move nothing', async () => {
                const cleared = await ringoPlayer('attack1');
                cleared.setLoopCount(1);
                cleared.play();
                cleared.setTrackAnimation(1, 'walk');
                cleared.clearTrack(1);
                run(cleared, 1000);
                expect(cleared.isFinished).toBe(true);
                expect(cleared.trackCount).toBe(2);
                expect(cleared.isTicking).toBe(false);
                cleared.destroy();

                const silenced = await ringoPlayer('attack1');
                silenced.setLoopCount(1);
                silenced.play();
                silenced.setTrackAnimation(1, 'walk');
                silenced.setTrackAlpha(1, 0);
                run(silenced, 1000);
                expect(silenced.isFinished).toBe(true);
                expect(silenced.isTicking).toBe(false);
                silenced.destroy();
            });

            it('stops ticking once track 0 finishes with nothing else to run', async () => {
                const player = await ringoPlayer('attack1');
                player.setLoopCount(1);
                player.play();
                run(player, 1000);
                expect(player.isFinished).toBe(true);
                expect(player.isTicking).toBe(false);
                player.destroy();
            });
        });

        describe('events', () => {
            it('come from the incoming animation across a crossfade, read from its own table', async () => {
                const player = new DirectInternalPlayer(textures);
                player.bindResource(userData);
                await player.prepareResources();
                const anim = player.animationNames[0];
                player.setAnimation(anim);
                player.play();
                const outgoing = player.getTrackMainSource(0)!;
                player.crossfade(0, anim, 4000);
                const incoming = player.getTrackMainSource(0)!;

                const manager = player.runtimeManager;
                const sources = new Set<number>();
                let read = 0;
                for (let i = 0; i < 119; i++) {
                    player.update(1000 / 30);
                    for (const event of manager.capturePassedEvents()) {
                        sources.add(event.source);
                        if (manager.getEventsOf(event)) read++;
                    }
                }
                expect(sources.has(incoming)).toBe(true);
                // The outgoing side is silent by default.
                expect(sources.has(outgoing)).toBe(false);
                expect(read).toBeGreaterThan(0);
                player.destroy();
            });

            it('let the outgoing side fire while its share is at the track\'s threshold', async () => {
                const player = new DirectInternalPlayer(textures);
                player.bindResource(userData);
                await player.prepareResources();
                const anim = player.animationNames[0];
                player.setAnimation(anim);
                player.setTrackOutgoingEventThreshold(0, 0.5);
                player.play();
                const outgoing = player.getTrackMainSource(0)!;
                player.crossfade(0, anim, 4000);

                const ctx = player.runtimeManager.context;
                const firedAt: number[] = [];
                for (let i = 0; i < 119; i++) {
                    player.update(1000 / 30);
                    for (let e = 0; e < ctx.get_passed_event_count(); e++) {
                        if (ctx.get_passed_event_source_handle(e) === outgoing) firedAt.push(player.getTrackFadeProgress(0)!);
                    }
                }
                expect(firedAt.length).toBeGreaterThan(0);
                expect(firedAt.every(p => p <= 0.5 + 1e-4)).toBe(true);
                player.destroy();
            });
        });
    },
);
