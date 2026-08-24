import { describe, it, expect, vi } from 'vitest';
import { InternalPlayerBase } from '../src/InternalPlayerBase.js';

// The loop count is per-animation in the runtime: `setup_animation` resets it to
// the infinite sentinel, because a count is something a transition states. It is
// NOT per-animation to a caller, who set it on the player and expects it to hold
// — so the player puts it back after every switch. Every other Player with a
// node or a widget to hang it on does the same; this one used to be the
// exception, and a configured `loopCount = 3` quietly became "forever" the
// moment the animation changed.
//
// Runs against a fake rather than booting WASM, the same trick the neighbouring
// suites use.

function makePlayer() {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const set_loop = vi.fn();
    const player = Object.create(InternalPlayerBase.prototype) as any;
    player.runtimeManager = {
        context: {
            get_ssab_buf: () => 0,
            get_ssab_len: () => 0,
            set_loop,
            // What the runtime would report back: everything at or below zero
            // normalizes to the infinite sentinel.
            get_loops: () => (set_loop.mock.lastCall?.[0] ?? -1) > 0
                ? set_loop.mock.lastCall![0]
                : -1,
        },
        setupAnimation: vi.fn(),
        getInstanceParts: () => [],
        getEffectParts: () => [],
        getSounds: () => [],
    };
    player._resourceManager = { loadTexture: vi.fn(), getTexture: () => null, destroy: () => {} };
    player._texturePaths = [];
    player._assetBaseUrl = '';
    player._ssabResource = {};
    player._instanceChildren = new Map();
    player._effectChildren = new Map();
    player._instancePackResources = new Map();
    player._animationName = '';
    player._prepared = null;
    player._resourcesReady = true;
    player._soundsPreloadedFor = null;
    player._soundsPromise = null;
    player._catchUpPending = false;
    player._isChildPlayer = false;
    player._audioManager = null;
    // Object.create skips the constructor, so the field initializers with it.
    player._loopCount = -1;
    return { player: player as InternalPlayerBase<never> & Record<string, any>, set_loop };
    /* eslint-enable @typescript-eslint/no-explicit-any */
}

describe('the loop count is the caller\'s, not the animation\'s', () => {
    it('goes back on after every setAnimation', () => {
        const { player, set_loop } = makePlayer();

        player.setLoop(3);
        expect(set_loop).toHaveBeenLastCalledWith(3);

        player.setAnimation('walk');
        expect(set_loop).toHaveBeenLastCalledWith(3);
        expect(player.getLoop()).toBe(3);

        player.setAnimation('idle');
        expect(set_loop).toHaveBeenLastCalledWith(3);
    });

    it('defaults to infinite, and pushes that too', () => {
        const { player, set_loop } = makePlayer();

        player.setAnimation('walk');
        expect(set_loop).toHaveBeenLastCalledWith(-1);
        expect(player.getLoop()).toBe(-1);
    });

    it('reads back a zero as the infinite it asked for', () => {
        const { player } = makePlayer();

        player.setLoop(0);
        expect(player.getLoop()).toBe(-1);

        // And the zero is what carries, so it still means infinite next time.
        player.setAnimation('walk');
        expect(player.getLoop()).toBe(-1);
    });
});
