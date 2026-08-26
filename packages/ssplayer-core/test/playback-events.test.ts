import { describe, it, expect } from 'vitest';
import { InternalPlayerBase } from '../src/InternalPlayerBase.js';

// `pollPlaybackEvents` only touches `runtimeManager.context` and its own edge
// latch, so it can be exercised against a fake context without booting WASM.
// This logic used to be copy-pasted into every renderer package; the point of
// hoisting it here is that these cases are pinned once.
function makePlayer(ctx: { is_looped: () => boolean; is_finished: () => boolean }) {
    const player = Object.create(InternalPlayerBase.prototype) as InternalPlayerBase<never>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (player as any).runtimeManager = { context: ctx };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (player as any)._prevFinished = false;
    return player;
}

describe('pollPlaybackEvents', () => {
    it('passes looped through verbatim — it is a pulse the runtime already clears', () => {
        const state = { looped: false, finished: false };
        const player = makePlayer({
            is_looped: () => state.looped,
            is_finished: () => state.finished,
        });

        expect(player.pollPlaybackEvents().looped).toBe(false);
        state.looped = true;
        expect(player.pollPlaybackEvents().looped).toBe(true);
        state.looped = false;
        expect(player.pollPlaybackEvents().looped).toBe(false);
    });

    it('reports finished once, on the rising edge of the sticky state', () => {
        const state = { looped: false, finished: false };
        const player = makePlayer({
            is_looped: () => state.looped,
            is_finished: () => state.finished,
        });

        expect(player.pollPlaybackEvents().finished).toBe(false);

        // is_finished latches true and stays true until the next play/setup.
        state.finished = true;
        expect(player.pollPlaybackEvents().finished).toBe(true);
        expect(player.pollPlaybackEvents().finished).toBe(false);
        expect(player.pollPlaybackEvents().finished).toBe(false);
    });

    it('reports a fresh finish after the latch is re-armed by play', () => {
        const state = { looped: false, finished: true };
        const player = makePlayer({
            is_looped: () => state.looped,
            is_finished: () => state.finished,
        });

        expect(player.pollPlaybackEvents().finished).toBe(true);
        expect(player.pollPlaybackEvents().finished).toBe(false);

        // What play() does: drop the latch. The runtime clears is_finished too.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (player as any)._prevFinished = false;
        state.finished = false;
        expect(player.pollPlaybackEvents().finished).toBe(false);

        state.finished = true;
        expect(player.pollPlaybackEvents().finished).toBe(true);
    });

    it('reports looped and finished independently in the same poll', () => {
        const player = makePlayer({ is_looped: () => true, is_finished: () => true });
        expect(player.pollPlaybackEvents()).toEqual({ looped: true, finished: true });
    });
});

describe('isFinished', () => {
    it('passes the sticky state through, unlike the edge the poll returns', () => {
        const state = { looped: false, finished: false };
        const player = makePlayer({
            is_looped: () => state.looped,
            is_finished: () => state.finished,
        });

        expect(player.isFinished).toBe(false);

        state.finished = true;
        // The poll reports the edge once...
        expect(player.pollPlaybackEvents().finished).toBe(true);
        expect(player.pollPlaybackEvents().finished).toBe(false);
        // ...while the state stays readable for as long as it holds. That is the
        // whole point of publishing it: a caller that was not subscribed when the
        // edge went by can still ask whether the run is over.
        expect(player.isFinished).toBe(true);
        expect(player.isFinished).toBe(true);
    });

    it('does not latch on its own — it reads the runtime every time', () => {
        const state = { looped: false, finished: true };
        const player = makePlayer({
            is_looped: () => state.looped,
            is_finished: () => state.finished,
        });

        expect(player.isFinished).toBe(true);
        // What play()/setAnimation() do on the runtime side. No local copy here
        // means nothing to leave stale.
        state.finished = false;
        expect(player.isFinished).toBe(false);
    });
});
