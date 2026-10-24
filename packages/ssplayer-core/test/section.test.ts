import { existsSync, readFileSync } from 'node:fs';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { initializeWasm } from '../src/SSRuntimeManager.js';
import { DirectInternalPlayer } from '../src/DirectInternalPlayer.js';
import { CONVERTER_WASM, RUNTIME_WASM, convert, sdkProject, textures } from './real-runtime.js';

// The playback section as the runtime takes it: both ends included, an end
// outside the animation is its edge, and a section running backwards is
// refused. Plays the SDK's overall Signal, whose anime_1 runs 0..30.

const PROJECT = sdkProject('overall');

describe.skipIf(!existsSync(RUNTIME_WASM) || !existsSync(CONVERTER_WASM) || !existsSync(PROJECT))(
    'setAnimationSection',
    () => {
        afterEach(() => {
            vi.restoreAllMocks();
        });

        async function loaded(): Promise<DirectInternalPlayer> {
            await initializeWasm(readFileSync(RUNTIME_WASM));
            const packs = await convert(PROJECT);
            const player = new DirectInternalPlayer(textures);
            player.bindResource(packs.get('Signal.ssab')!);
            await player.prepareResources();
            player.setAnimation('anime_1');
            return player;
        }

        const section = (player: DirectInternalPlayer) =>
            [player.getAnimationSectionStart(), player.getAnimationSectionEnd()];

        it('holds the last frame when the section starts on it', async () => {
            const player = await loaded();
            expect(player.setAnimationSection(30, 30)).toBe(true);
            expect(section(player)).toEqual([30, 30]);
            expect(player.setAnimationSection(30, -1)).toBe(true);
            expect(section(player)).toEqual([30, 30]);
            player.destroy();
        }, 60_000);

        it('refuses a section whose end is before its start, keeps the one it had, and reports it once', async () => {
            const player = await loaded();
            expect(player.setAnimationSection(10, 20)).toBe(true);
            player.setFrameNo(15);
            const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

            expect(player.setAnimationSection(20, 10)).toBe(false);
            expect(player.setAnimationSection(20, 10)).toBe(false);
            expect(section(player)).toEqual([10, 20]);
            expect(player.getFrameNo()).toBe(15);

            expect(warn).toHaveBeenCalledTimes(1);
            const said = String(warn.mock.calls[0][0]);
            expect(said).toContain('20..10');
            expect(said).toContain('animation "anime_1"');
            player.destroy();
        }, 60_000);

        it('still takes an end outside the animation as its edge, whatever its number', async () => {
            const player = await loaded();
            expect(player.setAnimationSection(20, -1)).toBe(true);
            expect(section(player)).toEqual([20, 30]);
            expect(player.setAnimationSection(-1, -1)).toBe(true);
            expect(section(player)).toEqual([0, 30]);
            expect(player.setAnimationSection(40, 3)).toBe(true);
            expect(section(player)).toEqual([0, 3]);
            player.destroy();
        }, 60_000);
    },
);
