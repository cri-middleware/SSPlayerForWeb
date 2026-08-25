import { describe, it, expect, vi, beforeEach } from 'vitest';
import { InternalPlayerBase } from '../src/InternalPlayerBase.js';
import { SSRuntimeManager } from '../src/SSRuntimeManager.js';

// Selecting the animation that is already selected does nothing: there is no
// switch to make, so the playhead stays, the instance tree is not rebuilt, and
// the override layer survives. That is what lets a state machine call
// `setAnimation(state.clip)` every frame without paying a context reset for it,
// and it is what ForGodot and ForRen'Py have always done.
//
// The trap this suite exists for is the OTHER half of the rule: "the same name"
// has to mean "already set up on the pack that is bound NOW". Bind a different
// pack that happens to name an animation the same way and the switch must still
// happen, or the new pack is left bound and unplayable — silently, and only for
// the packs whose animation names happen to collide.
//
// Runs against a fake rather than booting WASM, the same trick the neighbouring
// suites use. `bindResource` is the one call here that reaches for the real
// thing (it constructs an SSABResource), so that one class is stubbed out.

vi.mock('../src/SSRuntimeManager.js', async (importOriginal) => {
    const actual = await importOriginal<Record<string, unknown>>();
    class FakeSSABResource {
        constructor(public readonly raw: Uint8Array) {}
        destroy(): void {}
    }
    return { ...actual, SSABResource: FakeSSABResource };
});

function makePlayer() {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const setupAnimation = vi.fn();
    const player = Object.create(InternalPlayerBase.prototype) as any;
    player.runtimeManager = {
        context: {
            get_ssab_buf: () => 0,
            get_ssab_len: () => 0,
            set_loop: vi.fn(),
            get_loops: () => -1,
        },
        setupAnimation,
        bindResource: vi.fn(),
        getInstanceParts: () => [],
        getEffectParts: () => [],
        getSounds: () => [],
    };
    player._resourceManager = { loadTexture: vi.fn(), getTexture: () => null, destroy: () => {} };
    player._texturePaths = [];
    player._assetBaseUrl = '';
    player._ssabResource = null;
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
    return { player: player as InternalPlayerBase<never> & Record<string, any>, setupAnimation };
    /* eslint-enable @typescript-eslint/no-explicit-any */
}

beforeEach(() => {
    // Both read the .ssab's FlatBuffers; the fake bytes below are not one.
    vi.spyOn(SSRuntimeManager, 'extractTexturePaths').mockReturnValue([]);
    vi.spyOn(SSRuntimeManager, 'extractAnimationNames').mockReturnValue(['walk']);
});

describe('selecting the animation already selected', () => {
    it('does not reach the runtime a second time', () => {
        const { player, setupAnimation } = makePlayer();

        player.setAnimation('walk');
        expect(setupAnimation).toHaveBeenCalledTimes(1);

        player.setAnimation('walk');
        player.setAnimation('walk');
        expect(setupAnimation).toHaveBeenCalledTimes(1);
        expect(player.animationName).toBe('walk');
    });

    it('still switches when the name actually changes, and back again', () => {
        const { player, setupAnimation } = makePlayer();

        player.setAnimation('walk');
        player.setAnimation('idle');
        player.setAnimation('walk');

        expect(setupAnimation).toHaveBeenCalledTimes(3);
        expect(setupAnimation).toHaveBeenLastCalledWith('walk');
    });

    it('sets up again after another pack is bound under the same name', () => {
        const { player, setupAnimation } = makePlayer();

        player.setAnimation('walk');
        expect(setupAnimation).toHaveBeenCalledTimes(1);

        // A different pack, which happens to call one of its animations "walk"
        // too. Nothing is set up on it yet, so the switch has to happen — the
        // name matching what the PREVIOUS pack had selected means nothing.
        player.bindResource(new Uint8Array([0x53, 0x53, 0x41, 0x42]));
        expect(player.animationName).toBe('');

        player.setAnimation('walk');
        expect(setupAnimation).toHaveBeenCalledTimes(2);
        expect(player.animationName).toBe('walk');
    });

    it('sets up again after a shared pack is rebound under the same name', () => {
        const { player, setupAnimation } = makePlayer();

        player.setAnimation('walk');
        player.bindSharedResource({ destroy: vi.fn() } as never);
        expect(player.animationName).toBe('');

        player.setAnimation('walk');
        expect(setupAnimation).toHaveBeenCalledTimes(2);
    });
});
