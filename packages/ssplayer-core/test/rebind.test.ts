import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import * as nodePath from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, vi } from 'vitest';
import { convertProject, init as initConverter } from '@spritestudio/ssconverter-core';
import { initializeWasm } from '../src/SSRuntimeManager.js';
import { DirectInternalPlayer } from '../src/DirectInternalPlayer.js';
import type { IResourceManager } from '../src/IResourceManager.js';

// Binding another pack leaves nothing set up until the next setAnimation: the
// runtime empties its tracks on a bind, and the manager has to forget the old
// pack's animation with it. A renderer draws whenever the animation it last drew
// changes, so the frame between a load's bind and its setAnimation is drawn, and
// with the old animation's index still cached it reached the runtime, which
// logged "Animation not found" for it.
//
// Boots the real runtime, since what a bind leaves set up is the runtime's to
// say. Plays the SDK's Ringo, converted here, which gives two packs. Skipped
// without the converter WASM, the runtime WASM or the SDK submodule.

const here = nodePath.dirname(fileURLToPath(import.meta.url));
const repoRoot = nodePath.resolve(here, '../../..');
const RUNTIME_WASM = nodePath.join(repoRoot, 'packages/ssplayer-core/wasm/ssruntime_bg.wasm');
const CONVERTER_WASM = nodePath.join(repoRoot, 'packages/ssconverter-core/wasm/ssconverter_bg.wasm');
const RINGO = nodePath.join(repoRoot, 'SpriteStudio-SDK/tests/Ringo');

async function convert(project: string): Promise<Map<string, Uint8Array>> {
    await initConverter(readFileSync(CONVERTER_WASM));
    const dir = nodePath.basename(project);
    const files = new Map<string, Uint8Array>();
    for (const name of readdirSync(project)) {
        const full = nodePath.join(project, name);
        if (statSync(full).isFile()) files.set(`${dir}/${name}`, new Uint8Array(readFileSync(full)));
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

describe.skipIf(!existsSync(RUNTIME_WASM) || !existsSync(CONVERTER_WASM) || !existsSync(RINGO))(
    'binding another pack',
    () => {
        it('sets nothing up, so a draw before setAnimation evaluates nothing and logs nothing', async () => {
            await initializeWasm(readFileSync(RUNTIME_WASM));
            const packs = await convert(RINGO);
            const player = new DirectInternalPlayer(textures);
            player.bindResource(packs.get('Ringo.ssab')!);
            await player.prepareResources();
            player.setAnimation('walk');
            const manager = player.runtimeManager;
            expect(manager.getFrameData(0)).not.toBeNull();

            const error = vi.spyOn(console, 'error').mockImplementation(() => {});
            try {
                player.bindResource(packs.get('Ringo_tyu.ssab')!);

                // The draw a renderer makes before the load gets to setAnimation.
                expect(manager.getFrameData(0)).toBeNull();
                expect(error).not.toHaveBeenCalled();
                // Nor is anything read out of the old pack's animation.
                expect(manager.getCurrentAnimationData()).toBeNull();
                expect(manager.getPartMaskFlags()).toBeNull();

                const name = player.animationNames[0];
                player.setAnimation(name);
                expect(manager.getCurrentAnimationData()!.name()).toBe(name);
                expect(manager.getFrameData(0)).not.toBeNull();
                expect(error).not.toHaveBeenCalled();
            } finally {
                error.mockRestore();
                player.destroy();
            }
        }, 120_000);
    },
);
