import { describe, it, expect, vi } from 'vitest';
import { InternalPlayerBase } from '../src/InternalPlayerBase.js';

// A name the pack does not have has to come back as a failure that says which
// pack and which name (SDK: `20_design/40_api_conventions`, §7).
//
// The wasm boundary throws the Brain's error enum as a bare string —
// "AnimationNotFound" — which names neither. This layer is the only one holding
// both, so it is the only one that can say. The reason still goes in verbatim,
// because it is what separates "that name is not in this pack" from "this player
// has no pack bound at all", and those send a reader to different places.
//
// Fake context rather than booting WASM, the same trick the neighbouring suites
// use.

function makePlayer(ssabUrl: string, throws: unknown) {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const setupAnimation = vi.fn(() => {
        throw throws;
    });
    const player = Object.create(InternalPlayerBase.prototype) as any;
    player.runtimeManager = {
        context: { set_loop: vi.fn(), get_loops: () => -1 },
        setupAnimation,
    };
    player._ssabUrl = ssabUrl;
    player._animationName = 'walk';
    player._loopCount = -1;
    player._instanceChildren = new Map();
    player._effectChildren = new Map();
    return { player: player as InternalPlayerBase<never> & Record<string, any>, setupAnimation };
    /* eslint-enable @typescript-eslint/no-explicit-any */
}

describe('selecting a name the pack does not have', () => {
    it('names the pack, the name asked for, and the reason', () => {
        const { player } = makePlayer('/assets/Ringo.ssab', 'AnimationNotFound');

        let thrown: unknown;
        try {
            player.setAnimation('wakl');
        } catch (e) {
            thrown = e;
        }

        expect(thrown).toBeInstanceOf(Error);
        const message = (thrown as Error).message;
        expect(message).toContain('/assets/Ringo.ssab');
        expect(message).toContain('"wakl"');
        expect(message).toContain('AnimationNotFound');
        // The original is kept, so a host that wants to branch on it still can.
        expect((thrown as Error).cause).toBe('AnimationNotFound');
    });

    it('leaves the selection alone, so the no-op guard cannot be fooled', () => {
        const { player, setupAnimation } = makePlayer('/assets/Ringo.ssab', 'AnimationNotFound');

        expect(() => player.setAnimation('wakl')).toThrow();
        // Still the animation that IS set up — assigning the failed name here
        // would make a second attempt at it return silently through the
        // "same animation is a no-op" early return.
        expect(player.currentAnimation).toBe('walk');

        expect(() => player.setAnimation('wakl')).toThrow();
        expect(setupAnimation).toHaveBeenCalledTimes(2);
    });

    it('says so plainly when the pack was bound as bytes with no URL', () => {
        const { player } = makePlayer('', 'NotLoaded');

        expect(() => player.setAnimation('anything')).toThrow(/the loaded pack/);
    });
});
