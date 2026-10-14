import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import * as nodePath from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, vi } from 'vitest';
import { convertProject, init as initConverter } from '@spritestudio/ssconverter-core';
import { initializeWasm, SSABResource } from '../src/SSRuntimeManager.js';
import { DirectInternalPlayer } from '../src/DirectInternalPlayer.js';
import { DrawBatchKind } from '../src/ss/runtime/draw-batch-kind.js';
import type { IResourceManager } from '../src/IResourceManager.js';

// Binding another pack leaves nothing set up until the next setAnimation: the
// runtime empties its tracks on a bind, and the manager has to forget the old
// pack's animation with it. A renderer draws whenever the animation it last drew
// changes, so the frame between a load's bind and its setAnimation is drawn, and
// with the old animation's index still cached it reached the runtime, which
// logged "Animation not found" for it.
//
// A bind is also all or nothing, and the old pack goes with everything that
// was its own. Bytes that are not a pack leave the bound pack as it was. Bytes
// bound without a URL forget the old pack's directory. The instances set up on
// the old pack are torn down, and a load still running for it neither stands
// in for the new pack's load nor adds to the new pack's instance packs.
//
// Boots the real runtime, since what a bind leaves set up is the runtime's to
// say. Plays the SDK's Ringo, converted here, which gives two packs, and the
// SDK's overall for its effects and instances. Skipped without the converter
// WASM, the runtime WASM or the SDK submodule.

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

/** A resource manager that records the URL of every texture it is asked for. */
function recording(urls: string[]): IResourceManager {
    return {
        loadTexture: async (url: string) => { urls.push(url); },
        getTexture: () => null,
        destroy: () => {},
    };
}

/** The particles a renderer would draw this tick: the quads of every effect plan in the frame. */
function effectQuads(player: DirectInternalPlayer): number {
    const frameData = player.runtimeManager.getFrameData(player.getDrawFrame());
    if (!frameData) return 0;
    const order = frameData.drawOrderArray()!;
    let quads = 0;
    for (let b = 0; b < frameData.drawBatchesLength(); b++) {
        const batch = frameData.drawBatches(b)!;
        if (batch.kind() !== DrawBatchKind.Effect) continue;
        for (let c = 0; c < batch.count(); c++) {
            const plan = player.getEffectDrawPlan(order[batch.startRank() + c]);
            for (let k = 0; plan && k < plan.commandsLength(); k++) quads += plan.commands(k)!.quadCount();
        }
    }
    return quads;
}

/** Ticks `player` for `ticks` frames and returns the most particles any of them drew. */
function playFor(player: DirectInternalPlayer, ticks: number): number {
    let most = 0;
    for (let i = 0; i < ticks; i++) {
        player.update(1000 / player.getFrameRate());
        most = Math.max(most, effectQuads(player));
    }
    return most;
}

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

        it('refuses bytes that are not a pack, and leaves the pack it has playing', async () => {
            await initializeWasm(readFileSync(RUNTIME_WASM));
            const packs = await packsOf(OVERALL);
            const player = new DirectInternalPlayer(textures);
            player.bindResource(packs.get('Effect.ssab')!, 'packs/Effect.ssab');
            await player.prepareResources();
            player.setAnimation('anime_1');
            player.play();
            expect(playFor(player, 120)).toBeGreaterThan(0);

            const error = vi.spyOn(console, 'error').mockImplementation(() => {});
            try {
                // A truncated download, or the wrong file dropped on the page.
                expect(() => player.bindResource(new Uint8Array(64), 'packs/broken.ssab')).toThrow('Not a .ssab');
                expect(player.ssabUrl).toBe('packs/Effect.ssab');
                expect(player.currentAnimation).toBe('anime_1');

                // A replay rebuilds the effects from the pack still bound.
                player.play();
                expect(playFor(player, 120)).toBeGreaterThan(0);
                expect(error).not.toHaveBeenCalled();
            } finally {
                error.mockRestore();
                player.destroy();
            }
        }, 120_000);

        it('forgets the old URL when bytes are bound without one', async () => {
            await initializeWasm(readFileSync(RUNTIME_WASM));
            const ringo = (await packsOf(RINGO)).get('Ringo.ssab')!;
            const urls: string[] = [];
            const player = new DirectInternalPlayer(recording(urls));
            player.bindResource(ringo, 'old/Ringo.ssab');
            await player.prepareResources();
            expect(urls.length).toBeGreaterThan(0);
            expect(urls.every(url => url.startsWith('old/'))).toBe(true);

            urls.length = 0;
            player.bindResource(ringo);
            expect(player.ssabUrl).toBe('');
            await player.prepareResources();
            // Asked for again, and not from the directory of a pack no longer bound.
            expect(urls.length).toBeGreaterThan(0);
            expect(urls.filter(url => url.startsWith('old/'))).toEqual([]);
            player.destroy();
        }, 120_000);

        it('tears down the instances the old pack set up', async () => {
            await initializeWasm(readFileSync(RUNTIME_WASM));
            const packs = await packsOf(OVERALL);
            const player = new DirectInternalPlayer(textures);
            player.setInstancePackProvider(name => packs.get(`${name}.ssab`));
            player.bindResource(packs.get('Instance.ssab')!);
            await player.prepareResources();
            player.setAnimation(player.animationNames[0]);
            const parts = player.runtimeManager.getInstanceParts();
            expect(parts.length).toBeGreaterThan(0);
            for (const part of parts) expect(player.getInstanceChild(part.partIndex)).toBeDefined();

            player.bindResource((await packsOf(RINGO)).get('Ringo.ssab')!);
            for (const part of parts) expect(player.getInstanceChild(part.partIndex)).toBeUndefined();
            player.destroy();
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
