import { existsSync, readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { initializeWasm, type SSPassedEvent } from '../src/SSRuntimeManager.js';
import { DirectInternalPlayer } from '../src/DirectInternalPlayer.js';
import { CONVERTER_WASM, RUNTIME_WASM, convert, sdkProject, textures } from './real-runtime.js';

// The last pack asked for wins whichever answer arrives first, and a destroyed
// player binds nothing. Boots the real runtime and plays the SDK's Ringo, converted
// here. Skipped without the converter WASM, the runtime WASM or the SDK submodule.

const RINGO = sdkProject('Ringo');

/** A fetch each URL of which answers only when the test says so. */
function stubFetch(): Map<string, (bytes: Uint8Array) => void> {
    const answers = new Map<string, (bytes: Uint8Array) => void>();
    vi.stubGlobal('fetch', (url: string) => new Promise<Response>((resolve) => {
        answers.set(url, (bytes) => resolve(new Response(bytes as BodyInit)));
    }));
    return answers;
}

describe.skipIf(!existsSync(RUNTIME_WASM) || !existsSync(CONVERTER_WASM) || !existsSync(RINGO))(
    'a load answered out of turn',
    () => {
        afterEach(() => vi.unstubAllGlobals());

        it('leaves the pack asked for last', async () => {
            await initializeWasm(readFileSync(RUNTIME_WASM));
            const ringo = (await convert(RINGO)).get('Ringo.ssab')!;
            const answers = stubFetch();
            const player = new DirectInternalPlayer(textures);

            const first = player.load('a/Ringo.ssab');
            const second = player.load('b/Ringo.ssab');
            answers.get('b/Ringo.ssab')!(ringo);
            await second;
            answers.get('a/Ringo.ssab')!(ringo);
            await first;

            expect(player.ssabUrl).toBe('b/Ringo.ssab');
            player.destroy();
        }, 120_000);

        it('binds nothing on a player destroyed while it fetched', async () => {
            await initializeWasm(readFileSync(RUNTIME_WASM));
            const ringo = (await convert(RINGO)).get('Ringo.ssab')!;
            const answers = stubFetch();
            const player = new DirectInternalPlayer(textures);

            const loading = player.load('a/Ringo.ssab');
            player.destroy();
            answers.get('a/Ringo.ssab')!(ringo);

            await expect(loading).resolves.toBeUndefined();
            expect(player.destroyed).toBe(true);
        }, 120_000);

        it('reads no events on a player a listener destroyed', async () => {
            await initializeWasm(readFileSync(RUNTIME_WASM));
            const ringo = (await convert(RINGO)).get('Ringo.ssab')!;
            const player = new DirectInternalPlayer(textures);
            player.bindResource(ringo);
            const mgr = player.runtimeManager;
            const event = { source: 0, animationIndex: 0, eventIndex: 0, resource: mgr.resource } as SSPassedEvent;

            player.destroy();

            expect(mgr.getEventsOf(event)).toBeNull();
        }, 120_000);
    },
);
