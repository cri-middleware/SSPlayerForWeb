import { describe, expect, it, vi } from 'vitest';
import { SSTrackBlend } from '../src/Tracks.js';
import {
    applySavedTrack,
    applySavedTracks,
    withSavedTrack,
    withoutSavedTrack,
    type SSSavedTrack,
    type SSSavedTrackTarget,
} from '../src/SavedTracks.js';

// The saved-track list both tool adapters keep (ssplayer-rmmz on the picture,
// ssplayer-tyranoscript in its save slot) and how it is laid on a player.

const track = (n: number, animation = 'walk'): SSSavedTrack => ({
    track: n,
    animation,
    alpha: 0.5,
    blend: SSTrackBlend.Additive,
    loop: 2,
});

/** A target that records the track calls in order. */
function recorder() {
    const calls: string[] = [];
    const target: SSSavedTrackTarget = {
        getAnimationNames: () => ['walk', 'attack1'],
        setTrackAnimation: (t, a) => { calls.push(`set ${t} ${a}`); },
        crossfade: (t, a, ms) => { calls.push(`crossfade ${t} ${a} ${ms}`); },
        setTrackLoopCount: (t, n) => { calls.push(`loop ${t} ${n}`); },
        setTrackBlend: (t, b) => { calls.push(`blend ${t} ${b}`); },
        setTrackAlpha: (t, a) => { calls.push(`alpha ${t} ${a}`); },
    };
    return { target, calls };
}

describe('the saved track list', () => {
    it('replaces the entry for a track and keeps track order', () => {
        const list = withSavedTrack([track(3), track(1)], track(2, 'attack1'));
        expect(list.map(t => t.track)).toEqual([1, 2, 3]);
        expect(withSavedTrack(list, track(2)).filter(t => t.track === 2)).toEqual([track(2)]);
    });

    it('drops a track, and leaves nothing once the last one goes', () => {
        expect(withoutSavedTrack([track(1), track(2)], 1)).toEqual([track(2)]);
        expect(withoutSavedTrack([track(1)], 1)).toBeUndefined();
        expect(withoutSavedTrack(undefined, 1)).toBeUndefined();
    });
});

describe('applySavedTrack', () => {
    it('lays the animation before its loop count, blend and alpha', () => {
        const { target, calls } = recorder();
        expect(applySavedTrack(target, track(1))).toBe(true);
        expect(calls).toEqual(['set 1 walk', 'loop 1 2', `blend 1 ${SSTrackBlend.Additive}`, 'alpha 1 0.5']);
    });

    it('crossfades on the track when given a transition', () => {
        const { target, calls } = recorder();
        applySavedTrack(target, track(1, 'attack1'), 250);
        expect(calls[0]).toBe('crossfade 1 attack1 250');
    });

    it('skips an animation the pack does not have', () => {
        const { target, calls } = recorder();
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        expect(applySavedTrack(target, track(1, 'missing'))).toBe(false);
        expect(calls).toEqual([]);
        expect(warn).toHaveBeenCalledOnce();
        warn.mockRestore();
    });

    it('restores the rest of a list when one track fails', () => {
        const { target, calls } = recorder();
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        applySavedTracks(target, [track(1, 'missing'), track(2)]);
        expect(calls[0]).toBe('set 2 walk');
        warn.mockRestore();
    });
});
