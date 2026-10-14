import { existsSync, readFileSync } from 'node:fs';
import { describe, it, expect, vi } from 'vitest';
import { initializeWasm, SSABResource } from '../src/SSRuntimeManager.js';
import { DirectInternalPlayer } from '../src/DirectInternalPlayer.js';
import { CONVERTER_WASM, RUNTIME_WASM, convert, sdkProject, textures } from './real-runtime.js';

// A player destroyed while its pack loads leaves the load behind, and the load
// must stop where a bind would stop it. It used to go on: a player switched
// before its assets were in set its instances up on the runtime destroy() had
// freed, and logged the TypeError, and the instance packs it resolved after
// the destroy were never freed.
//
// Boots the real runtime and plays the SDK's Ringo and overall, converted
// here. Skipped without the converter WASM, the runtime WASM or the SDK
// submodule.

const RINGO = sdkProject('Ringo');
const OVERALL = sdkProject('overall');

/** Lets every promise settled so far run its handlers. */
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

describe.skipIf(!existsSync(RUNTIME_WASM) || !existsSync(CONVERTER_WASM) || !existsSync(RINGO) || !existsSync(OVERALL))(
    'a player destroyed while its pack loads',
    () => {
        it('does not set its instances up once the textures are in', async () => {
            await initializeWasm(readFileSync(RUNTIME_WASM));
            const ringo = (await convert(RINGO)).get('Ringo.ssab')!;
            const pending: (() => void)[] = [];
            const player = new DirectInternalPlayer({
                loadTexture: () => new Promise<void>(resolve => pending.push(resolve)),
                getTexture: () => null,
                destroy: () => {},
            });
            player.bindResource(ringo, 'a/Ringo.ssab');
            player.setAnimation('walk'); // loads the assets in the background
            expect(pending.length).toBeGreaterThan(0);

            const error = vi.spyOn(console, 'error').mockImplementation(() => {});
            try {
                player.destroy();
                for (const resolve of pending.splice(0)) resolve();
                await settle();
                expect(error).not.toHaveBeenCalled();
            } finally {
                error.mockRestore();
            }
        }, 120_000);

        it('frees the instance packs it resolves after the destroy', async () => {
            await initializeWasm(readFileSync(RUNTIME_WASM));
            const packs = await convert(OVERALL);
            const asked: (() => void)[] = [];
            const player = new DirectInternalPlayer(textures);
            // Hands an instance pack over only when the test says so.
            player.setInstancePackProvider(name => new Promise(resolve => asked.push(() => resolve(packs.get(`${name}.ssab`)))));
            player.bindResource(packs.get('Instance.ssab')!);
            const loading = player.prepareResources();
            await settle();
            expect(asked.length).toBeGreaterThan(0);

            player.destroy();
            const destroy = vi.spyOn(SSABResource.prototype, 'destroy');
            try {
                // Hand over every instance pack the load asks for, nested ones too.
                while (asked.length > 0) {
                    asked.shift()!();
                    await settle();
                }
                await loading;
                expect(destroy.mock.contexts.length).toBeGreaterThan(0);
                for (const resource of destroy.mock.contexts) expect((resource as SSABResource).raw).toBeNull();
            } finally {
                destroy.mockRestore();
            }
        }, 120_000);
    },
);
