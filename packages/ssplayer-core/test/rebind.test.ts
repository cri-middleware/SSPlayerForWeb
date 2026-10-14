import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import * as nodePath from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, vi } from 'vitest';
import { convertProject, init as initConverter } from '@spritestudio/ssconverter-core';
import { initializeWasm, SSABResource } from '../src/SSRuntimeManager.js';
import { DirectInternalPlayer } from '../src/DirectInternalPlayer.js';
import type { IResourceManager } from '../src/IResourceManager.js';

// Binding another pack leaves nothing set up until the next setAnimation: the
// runtime empties its tracks on a bind, and the manager has to forget the old
// pack's animation with it. A renderer draws whenever the animation it last drew
// changes, so the frame between a load's bind and its setAnimation is drawn, and
// with the old animation's index still cached it reached the runtime, which
// logged "Animation not found" for it.
//
// A load still running for the old pack neither stands in for the new pack's
// load nor adds to the new pack's instance packs.
//
// Boots the real runtime, since what a bind leaves set up is the runtime's to
// say. Plays the SDK's Ringo, converted here, which gives two packs, and the
// SDK's overall for its instances. Skipped without the converter WASM, the
// runtime WASM or the SDK submodule.

const here = nodePath.dirname(fileURLToPath(import.meta.url));
const repoRoot = nodePath.resolve(here, '../../..');
const RUNTIME_WASM = nodePath.join(repoRoot, 'packages/ssplayer-core/wasm/ssruntime_bg.wasm');
const CONVERTER_WASM = nodePath.join(repoRoot, 'packages/ssconverter-core/wasm/ssconverter_bg.wasm');
const RINGO = nodePath.join(repoRoot, 'SpriteStudio-SDK/tests/Ringo');
const OVERALL = nodePath.join(repoRoot, 'SpriteStudio-SDK/tests/overall');

function projectFiles(dir: string, prefix: string, into: Map<string, Uint8Array>): Map<string, Uint8Array> {
    for (const name of readdirSync(dir)) {
        const full = nodePath.join(dir, name);
        if (statSync(full).isDirectory()) projectFiles(full, `${prefix}/${name}`, into);
        else into.set(`${prefix}/${name}`, new Uint8Array(readFileSync(full)));
    }
    return into;
}

async function convert(project: string): Promise<Map<string, Uint8Array>> {
    await initConverter(readFileSync(CONVERTER_WASM));
    const files = projectFiles(project, nodePath.basename(project), new Map());
    const result = convertProject(files);
    try {
        return new Map(result.output as Map<string, Uint8Array>);
    } finally {
        result.free();
    }
}

// Converted once per project for the whole file; conversion is the slow part.
const converted = new Map<string, Promise<Map<string, Uint8Array>>>();
function packsOf(project: string): Promise<Map<string, Uint8Array>> {
    let packs = converted.get(project);
    if (!packs) converted.set(project, packs = convert(project));
    return packs;
}

const textures: IResourceManager = {
    loadTexture: async () => {},
    getTexture: () => null,
    destroy: () => {},
};

/** Lets every promise settled so far run its handlers. */
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

describe.skipIf(!existsSync(RUNTIME_WASM) || !existsSync(CONVERTER_WASM) || !existsSync(RINGO) || !existsSync(OVERALL))(
    'binding another pack',
    () => {
        it('sets nothing up, so a draw before setAnimation evaluates nothing and logs nothing', async () => {
            await initializeWasm(readFileSync(RUNTIME_WASM));
            const packs = await packsOf(RINGO);
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

        it('does not let a load still running for the old pack stand in for the new one', async () => {
            await initializeWasm(readFileSync(RUNTIME_WASM));
            const ringo = (await packsOf(RINGO)).get('Ringo.ssab')!;
            const urls: string[] = [];
            const pending: (() => void)[] = [];
            const player = new DirectInternalPlayer({
                loadTexture: (url: string) => {
                    urls.push(url);
                    return new Promise<void>(resolve => pending.push(resolve));
                },
                getTexture: () => null,
                destroy: () => {},
            });

            // Switched before its assets are in, so they load in the background.
            player.bindResource(ringo, 'a/Ringo.ssab');
            player.setAnimation('walk');
            expect(urls.length).toBeGreaterThan(0);
            const oldLoads = pending.splice(0);

            urls.length = 0;
            player.bindResource(ringo, 'b/Ringo.ssab');
            player.setAnimation('walk');
            // The new pack loads its own textures, however far the old load got.
            expect(urls.length).toBeGreaterThan(0);
            expect(urls.every(url => url.startsWith('b/'))).toBe(true);

            // And it is not ready while they are out, whatever the old load does.
            let ready = false;
            void player.prepareResources().then(() => { ready = true; });
            for (const resolve of oldLoads) resolve();
            await settle();
            expect(ready).toBe(false);
            for (const resolve of pending.splice(0)) resolve();
            await settle();
            expect(ready).toBe(true);
            player.destroy();
        }, 120_000);

        it('frees what a load still running for the old pack resolves, and keeps it from the new pack', async () => {
            await initializeWasm(readFileSync(RUNTIME_WASM));
            const packs = await packsOf(OVERALL);
            const asked: (() => void)[] = [];
            const player = new DirectInternalPlayer(textures);
            // Hands an instance pack over only when the test says so.
            player.setInstancePackProvider(name => new Promise(resolve => asked.push(() => resolve(packs.get(`${name}.ssab`)))));
            player.bindResource(packs.get('Instance.ssab')!);
            const loading = player.prepareResources();
            await settle();
            expect(asked.length).toBeGreaterThan(0);

            player.bindResource((await packsOf(RINGO)).get('Ringo.ssab')!);
            const destroy = vi.spyOn(SSABResource.prototype, 'destroy');
            try {
                // Hand over every instance pack the old load asks for, nested ones too.
                while (asked.length > 0) {
                    asked.shift()!();
                    await settle();
                }
                await loading;
                // Every resource the old load made was freed. Had one gone to the
                // new pack's registry instead, nothing would have freed it here.
                expect(destroy.mock.contexts.length).toBeGreaterThan(0);
                for (const resource of destroy.mock.contexts) expect((resource as SSABResource).raw).toBeNull();
            } finally {
                destroy.mockRestore();
                player.destroy();
            }
        }, 120_000);
    },
);
