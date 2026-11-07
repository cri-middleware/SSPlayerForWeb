import { existsSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SSRuntimeManager } from '../src/SSRuntimeManager.js';
import { SSWebAudioManager } from '../src/SSWebAudioManager.js';
import { CONVERTER_WASM, convert, sdkProject } from './real-runtime.js';

// An embedded `.ssab` carries its sounds, and no file sits beside it to fetch.

const OVERALL = sdkProject('overall');

describe.skipIf(!existsSync(CONVERTER_WASM) || !existsSync(OVERALL))('extractSounds', () => {
    it('hands over the bytes of an embedded sound, and none for a sibling file', async () => {
        const embedded = (await convert(OVERALL, { embedded: true })).get('Sound.ssab')!;
        const sounds = SSRuntimeManager.extractSounds(embedded);
        expect(sounds.length).toBeGreaterThan(0);
        for (const sound of sounds) expect(sound.bytes?.length).toBeGreaterThan(0);

        const plain = (await convert(OVERALL)).get('Sound.ssab')!;
        for (const sound of SSRuntimeManager.extractSounds(plain)) expect(sound.bytes).toBeUndefined();
    }, 120_000);
});

describe('SSWebAudioManager', () => {
    afterEach(() => vi.unstubAllGlobals());

    it('decodes embedded bytes without fetching', async () => {
        const decodeAudioData = vi.fn(async (buffer: ArrayBuffer) => ({ duration: buffer.byteLength }));
        vi.stubGlobal('window', {
            AudioContext: class {
                state = 'running';
                decodeAudioData = decodeAudioData;
            },
        });
        const fetch = vi.fn();
        vi.stubGlobal('fetch', fetch);

        // A view into a larger buffer, as the player's copy need not be the whole of one.
        const bytes = new Uint8Array(new Uint8Array([9, 1, 2, 3, 9]).buffer, 1, 3);
        await new SSWebAudioManager().preload([{ name: 'hit', path: 'a/hit.mp3', bytes }]);

        expect(fetch).not.toHaveBeenCalled();
        expect(decodeAudioData).toHaveBeenCalledTimes(1);
        expect(Array.from(new Uint8Array(decodeAudioData.mock.calls[0][0]))).toEqual([1, 2, 3]);
    });

    it('keeps no bytes once a sound is decoded, failed, or already in memory', async () => {
        const decodeAudioData = vi.fn(async () => ({ duration: 1 }));
        vi.stubGlobal('window', {
            AudioContext: class {
                state = 'running';
                decodeAudioData = decodeAudioData;
            },
        });
        const manager = new SSWebAudioManager();
        const held = () => (manager as unknown as { soundBytes: Map<string, Uint8Array> }).soundBytes.size;
        const hit = { name: 'hit', path: 'a/hit.mp3', bytes: new Uint8Array([1]) };

        await manager.preload([hit]);
        expect(held()).toBe(0);
        await manager.preload([hit]);
        expect(held()).toBe(0);
        expect(decodeAudioData).toHaveBeenCalledTimes(1);

        const error = vi.spyOn(console, 'error').mockImplementation(() => {});
        decodeAudioData.mockRejectedValueOnce(new Error('bad data'));
        await manager.preload([{ name: 'bad', path: 'a/bad.mp3', bytes: new Uint8Array([2]) }]);
        expect(held()).toBe(0);
        error.mockRestore();
    });
});
