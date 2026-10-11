import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import * as nodePath from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { convertProject, init as initConverter } from '@spritestudio/ssconverter-core';
import { initializeWasm } from '../src/SSRuntimeManager.js';
import { DirectInternalPlayer } from '../src/DirectInternalPlayer.js';
import type { IResourceManager } from '../src/IResourceManager.js';

// isPartHidden reads the part's `hide` from the frame the renderer draws, and
// the runtime writes a visibility override and its cascade into that `hide`.
// So the answer includes a force-hide, as soon as it is set, and
// setPartVisibilityOverride(part, false) only reverts to the animation: it does
// not show a part the animation hides.
//
// Boots the real runtime, since which hide the frame carries is the runtime's
// to say. Plays the SDK's Doll, converted here, whose Action01_Body/Wait keys
// its effect part hidden; skipped without the converter WASM, the runtime WASM
// or the SDK submodule.

const here = nodePath.dirname(fileURLToPath(import.meta.url));
const repoRoot = nodePath.resolve(here, '../../..');
const RUNTIME_WASM = nodePath.join(repoRoot, 'packages/ssplayer-core/wasm/ssruntime_bg.wasm');
const CONVERTER_WASM = nodePath.join(repoRoot, 'packages/ssconverter-core/wasm/ssconverter_bg.wasm');
const PROJECT = nodePath.join(repoRoot, 'SpriteStudio-SDK/tests/Doll');

async function dollPacks(): Promise<Map<string, Uint8Array>> {
    await initConverter(readFileSync(CONVERTER_WASM));
    const files = new Map<string, Uint8Array>();
    for (const name of readdirSync(PROJECT)) {
        const full = nodePath.join(PROJECT, name);
        if (statSync(full).isFile()) files.set(`Doll/${name}`, new Uint8Array(readFileSync(full)));
    }
    const result = convertProject(files);
    try {
        return new Map(result.output as Map<string, Uint8Array>);
    } finally {
        result.free();
    }
}

const textures: IResourceManager = {
    loadTexture: async () => {},
    getTexture: () => null,
    destroy: () => {},
};

describe.skipIf(!existsSync(RUNTIME_WASM) || !existsSync(CONVERTER_WASM) || !existsSync(PROJECT))(
    'isPartHidden',
    () => {
        it('reports a visibility override and its cascade, and false only reverts', async () => {
            await initializeWasm(readFileSync(RUNTIME_WASM));
            const packs = await dollPacks();
            const player = new DirectInternalPlayer(textures);
            player.setInstancePackProvider(name => packs.get(`${name}.ssab`));
            player.bindResource(packs.get('Action01_Body.ssab')!);
            await player.prepareResources();
            player.setAnimation('Wait');
            player.play();
            player.update(100);

            // `Body` descends from `root`; Wait keys `effect_1` hidden.
            const hidden = () => [player.isPartHidden('root'), player.isPartHidden('Body'), player.isPartHidden('effect_1')];
            expect(hidden()).toEqual([false, false, true]);

            // Read back at once, with no tick in between.
            player.setPartVisibilityOverride('root', true);
            expect(hidden()).toEqual([true, false, true]);
            player.setPartVisibilityOverride('root', true, true);
            expect(hidden()).toEqual([true, true, true]);

            player.setPartVisibilityOverride('root', false);
            expect(hidden()).toEqual([false, false, true]);
            // There is no force-show: the animation's own hide stands.
            player.setPartVisibilityOverride('effect_1', false);
            expect(hidden()).toEqual([false, false, true]);

            player.setPartVisibilityOverride('Body', true);
            expect(hidden()).toEqual([false, true, true]);
            player.clearPartVisibilityOverride('Body');
            expect(hidden()).toEqual([false, false, true]);

            player.destroy();
        }, 60_000);
    },
);
