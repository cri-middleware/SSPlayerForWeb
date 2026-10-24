import { existsSync, readFileSync } from 'node:fs';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { initializeWasm } from '../src/SSRuntimeManager.js';
import { DirectInternalPlayer } from '../src/DirectInternalPlayer.js';
import { labelFrameOf, labelTableOf } from '../src/Labels.js';
import type { AnimationData } from '../src/ss/format/animation-data.js';
import { CONVERTER_WASM, RUNTIME_WASM, convert, sdkProject, textures } from './real-runtime.js';

// A playback section named by labels. The label table is read from the pack,
// not the runtime, so its two halves are tested apart: the table on a stand-in
// for the pack's AnimationData, and the section it sets on the SDK's overall
// Signal, whose anime_1 (frames 0..30) labels frames 10 (`Start`) and 20
// (`End`).

function animationWith(labels: { name: string; time: number }[], startFrame: number, endFrame: number): AnimationData {
    return {
        labelsLength: () => labels.length,
        labels: (i: number) => ({ name: () => labels[i].name, time: () => labels[i].time }),
        startFrame: () => startFrame,
        endFrame: () => endFrame,
    } as unknown as AnimationData;
}

describe('label table', () => {
    // Out of frame order, as the converter writes them (by name hash).
    const button = animationWith(
        [{ name: 'pressed', time: 40 }, { name: 'normal', time: 0 }, { name: 'hover', time: 20 }],
        0,
        59,
    );

    it('lists the labels in frame order', () => {
        const table = labelTableOf(button);
        expect(table.labels.map(l => l.name)).toEqual(['normal', 'hover', 'pressed']);
        expect(table.labels.map(l => l.frame)).toEqual([0, 20, 40]);
    });

    it('resolves a label, and _start / _end to the animation range', () => {
        const table = labelTableOf(button);
        expect(labelFrameOf(table, 'hover')).toBe(20);
        expect(labelFrameOf(table, '_start')).toBe(0);
        expect(labelFrameOf(table, '_end')).toBe(59);
        expect(labelFrameOf(table, 'Hover')).toBeNull();
    });

    it('lets a real label named _start win over the animation range', () => {
        const table = labelTableOf(animationWith([{ name: '_start', time: 5 }], 0, 9));
        expect(labelFrameOf(table, '_start')).toBe(5);
    });

    it('gives an animation without labels _start and _end', () => {
        const table = labelTableOf(animationWith([], 0, 9));
        expect(table.labels).toEqual([]);
        expect(labelFrameOf(table, '_end')).toBe(9);
    });
});

const PROJECT = sdkProject('overall');

describe.skipIf(!existsSync(RUNTIME_WASM) || !existsSync(CONVERTER_WASM) || !existsSync(PROJECT))(
    'setAnimationSectionByLabel',
    () => {
        afterEach(() => {
            vi.restoreAllMocks();
        });

        async function loaded(): Promise<DirectInternalPlayer> {
            await initializeWasm(readFileSync(RUNTIME_WASM));
            const packs = await convert(PROJECT);
            const player = new DirectInternalPlayer(textures);
            player.setInstancePackProvider(name => packs.get(`${name}.ssab`));
            player.bindResource(packs.get('Signal.ssab')!);
            await player.prepareResources();
            player.setAnimation('anime_1');
            return player;
        }

        const section = (player: DirectInternalPlayer) =>
            [player.getAnimationSectionStart(), player.getAnimationSectionEnd()];

        it('reads the label table of the current animation, or of one named', async () => {
            const player = await loaded();
            expect(player.getLabelTable()).toEqual({
                labels: [{ name: 'Start', frame: 10 }, { name: 'End', frame: 20 }],
                startFrame: 0,
                endFrame: 30,
            });
            expect(player.getLabelTable('anime_1')).toEqual(player.getLabelTable());
            expect(player.getLabelTable('nope')).toBeNull();
            player.destroy();
        }, 60_000);

        it('does nothing before an animation is set up', async () => {
            await initializeWasm(readFileSync(RUNTIME_WASM));
            const packs = await convert(PROJECT);
            const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
            const player = new DirectInternalPlayer(textures);
            expect(player.setAnimationSectionByLabel('Start', 'End')).toBe(false);
            player.bindResource(packs.get('Signal.ssab')!);
            expect(player.setAnimationSectionByLabel('Start', 'End')).toBe(false);
            expect(warn).not.toHaveBeenCalled();
            player.destroy();
        }, 60_000);

        it('runs from one label to the other, offsets added, and moves the playhead to the start', async () => {
            const player = await loaded();
            expect(player.setAnimationSectionByLabel('Start', 'End')).toBe(true);
            expect(section(player)).toEqual([10, 20]);
            expect(player.getFrameNo()).toBe(10);

            expect(player.setAnimationSectionByLabel('Start', 'End', 2, -1)).toBe(true);
            expect(section(player)).toEqual([12, 19]);
            player.destroy();
        }, 60_000);

        it('reads _start and _end as the ends of the animation, not of the section', async () => {
            const player = await loaded();
            expect(player.setAnimationSectionByLabel('End', '_end')).toBe(true);
            expect(section(player)).toEqual([20, 30]);
            expect(player.setAnimationSectionByLabel('_start', 'Start')).toBe(true);
            expect(section(player)).toEqual([0, 10]);
            player.destroy();
        }, 60_000);

        it('pulls an end before the start up to it', async () => {
            const player = await loaded();
            expect(player.setAnimationSectionByLabel('End', 'Start')).toBe(true);
            expect(section(player)).toEqual([20, 20]);
            player.destroy();
        }, 60_000);

        it('fails on a missing label, keeps the section, and reports it once', async () => {
            const player = await loaded();
            player.setAnimationSectionByLabel('Start', 'End');
            const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

            expect(player.setAnimationSectionByLabel('Start', 'Ned')).toBe(false);
            expect(player.setAnimationSectionByLabel('Start', 'Ned')).toBe(false);
            expect(section(player)).toEqual([10, 20]);

            expect(warn).toHaveBeenCalledTimes(1);
            const said = String(warn.mock.calls[0][0]);
            expect(said).toContain('"Ned"');
            expect(said).toContain('animation "anime_1"');
            expect(said).not.toContain('"Start"');
            player.destroy();
        }, 60_000);
    },
);
