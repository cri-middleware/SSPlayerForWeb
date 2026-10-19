import { existsSync, readFileSync } from 'node:fs';
import { describe, it, expect, beforeAll } from 'vitest';
import { initializeWasm } from '../src/SSRuntimeManager.js';
import { DirectInternalPlayer } from '../src/DirectInternalPlayer.js';
import { CONVERTER_WASM, RUNTIME_WASM, convert, sdkProject, textures } from './real-runtime.js';

// A mask plan walks a tree only when some pack in it has a part that can write
// a mask. Plays the SDK's overall project, converted here.

const OVERALL = sdkProject('overall');

describe.skipIf(!existsSync(RUNTIME_WASM) || !existsSync(CONVERTER_WASM) || !existsSync(OVERALL))(
    'mask writer parts',
    () => {
        let packs: Map<string, Uint8Array>;

        beforeAll(async () => {
            await initializeWasm(readFileSync(RUNTIME_WASM));
            packs = await convert(OVERALL);
        }, 120_000);

        async function playerOf(pack: string): Promise<DirectInternalPlayer> {
            const player = new DirectInternalPlayer(textures);
            player.bindResource(packs.get(pack)!);
            await player.prepareResources();
            player.setAnimation(player.animationNames[0]);
            return player;
        }

        it('are found in a pack with masks, and not in one without', async () => {
            const mask = await playerOf('Mask.ssab');
            const basic = await playerOf('Basic.ssab');
            expect(mask.hasMaskWriterParts()).toBe(true);
            expect(basic.hasMaskWriterParts()).toBe(false);
            mask.destroy();
            basic.destroy();
        });

        it('are found in an instance child\'s pack', async () => {
            const owner = await playerOf('Basic.ssab');
            const child = await playerOf('Mask.ssab');
            (owner as unknown as { _instanceChildren: Map<number, unknown> })._instanceChildren.set(0, { player: child });
            expect(owner.runtimeManager.hasMaskWriterParts()).toBe(false);
            expect(owner.hasMaskWriterParts()).toBe(true);
            (owner as unknown as { _instanceChildren: Map<number, unknown> })._instanceChildren.clear();
            owner.destroy();
            child.destroy();
        });
    },
);
