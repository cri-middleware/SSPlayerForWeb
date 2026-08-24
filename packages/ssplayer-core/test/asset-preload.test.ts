import { describe, it, expect, vi } from 'vitest';
import { InternalPlayerBase } from '../src/InternalPlayerBase.js';

// Assets belong to the pack, not to the animation: cell maps, instance-pack
// references and sound lists all live on the binary, so they are loaded once and
// an animation switch is a synchronous runtime reset. These cases pin that —
// they run against fakes rather than booting WASM, the same trick
// playback-events.test.ts uses.
//
// The fake context reports an empty SSAB buffer, so the embedded-texture and
// instance-pack passes short-circuit and only the ResourceManager and
// AudioManager calls are observed.

function makeResourceManager(loadTexture = vi.fn().mockResolvedValue(undefined)) {
    return { loadTexture, getTexture: () => null, destroy: () => {} };
}

function makePlayer(rm: unknown) {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const player = Object.create(InternalPlayerBase.prototype) as any;
    player.runtimeManager = {
        context: { get_ssab_buf: () => 0, get_ssab_len: () => 0, stop: () => {}, set_loop: () => {} },
        setupAnimation: vi.fn(),
        getInstanceParts: () => [],
        getEffectParts: () => [],
        getSounds: () => [{ name: 'se', path: 'se.wav' }],
    };
    player._resourceManager = rm;
    player._texturePaths = [{ hash: 0x1111, path: 'chara.png' }];
    player._assetBaseUrl = '/assets';
    player._ssabResource = {}; // truthy: a pack is bound
    player._instanceChildren = new Map();
    player._effectChildren = new Map();
    player._instancePackResources = new Map();
    player._animationName = '';
    player._prepared = null;
    player._resourcesReady = false;
    player._soundsPreloadedFor = null;
    player._soundsPromise = null;
    player._catchUpPending = false;
    player._isChildPlayer = false;
    player._audioManager = null;
    // Object.create skips the constructor, so the field initializers with it.
    player._loopCount = -1;
    return player as InternalPlayerBase<never> & Record<string, any>;
    /* eslint-enable @typescript-eslint/no-explicit-any */
}

describe('asset loading is per-pack, not per-animation', () => {
    it('loads each texture once, however many animations are played', async () => {
        const loadTexture = vi.fn().mockResolvedValue(undefined);
        const player = makePlayer(makeResourceManager(loadTexture));

        await player.prepareResources();
        player.setAnimation('idle');
        player.setAnimation('walk');
        player.setAnimation('run');

        expect(loadTexture).toHaveBeenCalledTimes(1);
        expect(loadTexture).toHaveBeenCalledWith('/assets/chara.png', 0x1111);
    });

    it('switches synchronously — no promise to await', () => {
        const player = makePlayer(makeResourceManager());

        const returned = player.setAnimation('walk');

        expect(returned).toBeUndefined();
        expect(player.animationName).toBe('walk');
    });

    it('switches immediately on an unprepared pack and loads it in the background', async () => {
        const loadTexture = vi.fn().mockResolvedValue(undefined);
        const player = makePlayer(makeResourceManager(loadTexture));

        player.setAnimation('idle');
        expect(player.animationName).toBe('idle'); // switched, textures or not

        await player.prepareResources(); // the same load the switch kicked off
        expect(loadTexture).toHaveBeenCalledTimes(1);
    });

    it('does not cache a failed load — the next attempt retries it', async () => {
        const loadTexture = vi
            .fn()
            .mockRejectedValueOnce(new Error('404'))
            .mockResolvedValue(undefined);
        const player = makePlayer(makeResourceManager(loadTexture));

        await expect(player.prepareResources()).rejects.toThrow('404');
        await player.prepareResources();

        expect(loadTexture).toHaveBeenCalledTimes(2);
    });
});

describe('sound preloading', () => {
    it('handles a pack with no sounds, which finishes before its first await', async () => {
        const player = makePlayer(makeResourceManager());
        player.runtimeManager.getSounds = () => [];
        const audio = { preload: vi.fn().mockResolvedValue(undefined), stopAll: vi.fn() };

        // The reason this deserves its own case: with nothing to preload the
        // work returns synchronously, so any bookkeeping that runs "after" it
        // runs before the promise it refers to exists. That threw
        // "Cannot access 'run' before initialization" out of load() for every
        // soundless pack that had an audio manager attached — which is most of
        // them.
        player.audioManager = audio;
        await expect(player.preloadSounds()).resolves.toBeUndefined();
        expect(audio.preload).not.toHaveBeenCalled();

        // And the whole of load() stays clear of it.
        await expect(player.prepareResources()).resolves.toBeUndefined();
    });

    it('runs on attach, once per audioManager, and never on a switch', async () => {
        const player = makePlayer(makeResourceManager());
        const first = { preload: vi.fn().mockResolvedValue(undefined), stopAll: vi.fn() };

        player.audioManager = first;
        await player.preloadSounds(); // awaits the work the attach started

        expect(first.preload).toHaveBeenCalledTimes(1);
        expect(first.preload).toHaveBeenCalledWith([{ name: 'se', path: '/assets/se.wav' }]);

        player.setAnimation('idle');
        player.setAnimation('walk');
        player.stop();
        expect(first.preload).toHaveBeenCalledTimes(1);
        // And neither a switch nor a stop touches the previous animation's sound:
        // what has started outlives the playback that triggered it. Only destroy()
        // sweeps the manager.
        expect(first.stopAll).not.toHaveBeenCalled();

        // A manager attached later still gets its own preload.
        const second = { preload: vi.fn().mockResolvedValue(undefined), stopAll: vi.fn() };
        player.audioManager = second;
        await player.preloadSounds();
        expect(second.preload).toHaveBeenCalledTimes(1);
    });

    it('waits for the pack before preloading, and preloads once it is bound', async () => {
        const player = makePlayer(makeResourceManager());
        player._ssabResource = null; // nothing bound yet
        const audio = { preload: vi.fn().mockResolvedValue(undefined), stopAll: vi.fn() };

        player.audioManager = audio;
        await player.preloadSounds();
        expect(audio.preload).not.toHaveBeenCalled();

        player._ssabResource = {}; // a pack lands (bindResource)
        await player.prepareResources();
        expect(audio.preload).toHaveBeenCalledTimes(1);
    });

    it('leaves instance children to the parent audio manager', async () => {
        const player = makePlayer(makeResourceManager());
        player._isChildPlayer = true;
        const audio = { preload: vi.fn().mockResolvedValue(undefined), stopAll: vi.fn() };

        player.audioManager = audio;
        await player.preloadSounds();

        expect(audio.preload).not.toHaveBeenCalled();
    });
});
