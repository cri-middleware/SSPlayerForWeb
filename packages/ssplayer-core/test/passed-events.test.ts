import { existsSync, readFileSync } from 'node:fs';
import { describe, it, expect, beforeAll } from 'vitest';
import { getWasmMemory, initializeWasm, type SSRuntimeManager, type SSPassedEvent } from '../src/SSRuntimeManager.js';
import { DirectInternalPlayer } from '../src/DirectInternalPlayer.js';
import { CONVERTER_WASM, RUNTIME_WASM, convert, sdkProject, textures } from './real-runtime.js';

// A listener that sets up another animation clears what the update reported in
// the runtime, and source 0 then names the new animation. What was captured
// before it ran still reads from the animation that fired it.

const DOLL = sdkProject('Doll');
// One tick past the end, so it crosses every key of the animation.
const PAST_THE_END = 100_000;
// Action02_Body's Run01 has event entries and its Wait has none, so reading Run01's
// indices from Wait's table reports nothing.
const WITHOUT_EVENTS = 'Wait';

describe.skipIf(!existsSync(RUNTIME_WASM) || !existsSync(CONVERTER_WASM) || !existsSync(DOLL))(
    'captured passed events',
    () => {
        let body: Uint8Array;
        let other: Uint8Array;

        beforeAll(async () => {
            await initializeWasm(readFileSync(RUNTIME_WASM));
            const packs = await convert(DOLL);
            body = packs.get('Action02_Body.ssab')!;
            other = packs.get('Action01_Body.ssab')!;
        }, 120_000);

        async function playedPastTheEnd(): Promise<DirectInternalPlayer> {
            const player = new DirectInternalPlayer(textures);
            player.bindResource(body);
            await player.prepareResources();
            player.setAnimation(player.animationNames[0]);
            player.play();
            player.update(PAST_THE_END);
            return player;
        }

        const frames = (manager: SSRuntimeManager, passed: readonly SSPassedEvent[]) =>
            passed.map(event => manager.getEventsOf(event)?.frameIndex());

        it('read the same after another animation is set up', async () => {
            const player = await playedPastTheEnd();
            const manager = player.runtimeManager;
            const passed = manager.capturePassedEvents();
            const read = frames(manager, passed);
            expect(read.length).toBeGreaterThan(0);

            player.setAnimation(WITHOUT_EVENTS);

            expect(manager.context.get_passed_event_count()).toBe(0);
            expect(manager.capturePassedEvents()).toEqual([]);
            expect(frames(manager, passed)).toEqual(read);
            // Fixture sanity: looked up in the set-up animation, they would be gone.
            const animationIndex = manager.context.get_current_animation_index()!;
            expect(frames(manager, passed.map(event => ({ ...event, animationIndex })))).not.toEqual(read);
            player.destroy();
        });

        it('read the same after WASM memory grows', async () => {
            const player = await playedPastTheEnd();
            const manager = player.runtimeManager;
            const passed = manager.capturePassedEvents();
            const read = frames(manager, passed);

            getWasmMemory().grow(1);

            expect(frames(manager, passed)).toEqual(read);
            player.destroy();
        });

        it('read as nothing once another pack is bound', async () => {
            const player = await playedPastTheEnd();
            const manager = player.runtimeManager;
            const passed = manager.capturePassedEvents();
            expect(passed.length).toBeGreaterThan(0);

            player.bindResource(other);

            expect(frames(manager, passed).every(frame => frame === undefined)).toBe(true);
            player.destroy();
        });
    },
);
