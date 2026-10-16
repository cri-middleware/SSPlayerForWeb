import type { SSTrackBlend } from './Tracks.js';

/**
 * The tracks a host lays above track 0, kept as plain data an adapter can save
 * and lay again on a rebuilt player — ssplayer-rmmz on the picture, ssplayer-
 * tyranoscript in its save slot. The runtime's stack lives on the WASM context,
 * which a rebuild starts from scratch.
 *
 * Fades are operations, not state: an entry holds where a fade ends, so a save
 * taken mid-fade restores the faded state.
 */
export interface SSSavedTrack {
    /** 1 or above: track 0 is the animation the adapter sets up itself. */
    track: number;
    animation: string;
    alpha: number;
    blend: SSTrackBlend;
    /** -1 (or 0) loops forever. */
    loop: number;
}

/**
 * The part of a player these helpers drive. Structural, as the part-override
 * target is, so every renderer facade satisfies it.
 */
export interface SSSavedTrackTarget {
    getAnimationNames(): readonly string[];
    setTrackAnimation(track: number, animationName: string): void;
    crossfade(track: number, animationName: string, durationMs: number): void;
    setTrackLoopCount(track: number, count: number): void;
    setTrackBlend(track: number, blend: SSTrackBlend): void;
    setTrackAlpha(track: number, alpha: number): void;
}

/**
 * Lay one track on `target`. Above 0, `transitionMs` crossfades from what the
 * track was playing; at 0 it cuts. Returns false, with a warning, for an
 * animation the pack does not have: a tool's command can name one no editor
 * checked.
 */
export function applySavedTrack(target: SSSavedTrackTarget, t: SSSavedTrack, transitionMs = 0): boolean {
    const names = target.getAnimationNames();
    if (!names.includes(t.animation)) {
        console.warn(`[ssplayer] track ${t.track}: animation "${t.animation}" not found. Available: ${names.join(', ')}.`);
        return false;
    }
    if (transitionMs > 0) {
        target.crossfade(t.track, t.animation, transitionMs);
    } else {
        target.setTrackAnimation(t.track, t.animation);
    }
    // An animation is laid looping forever, so the count goes on after it.
    target.setTrackLoopCount(t.track, t.loop);
    target.setTrackBlend(t.track, t.blend);
    target.setTrackAlpha(t.track, t.alpha);
    return true;
}

/** Lay every track of `list` on a player just set up; one that fails does not stop the rest. */
export function applySavedTracks(target: SSSavedTrackTarget, list: readonly SSSavedTrack[] | undefined): void {
    if (!list) return;
    for (const t of list) {
        try {
            applySavedTrack(target, t);
        } catch (e: unknown) {
            console.error(`[ssplayer] failed to restore track ${t.track}:`, e);
        }
    }
}

/** `list` with `t` in place of the entry for its track, kept in track order. */
export function withSavedTrack(list: readonly SSSavedTrack[] | undefined, t: SSSavedTrack): SSSavedTrack[] {
    return [...(list ?? []).filter(e => e.track !== t.track), t].sort((a, b) => a.track - b.track);
}

/** `list` without `track`; undefined once nothing is left, so a save stays as it was. */
export function withoutSavedTrack(list: readonly SSSavedTrack[] | undefined, track: number): SSSavedTrack[] | undefined {
    const rest = (list ?? []).filter(e => e.track !== track);
    return rest.length > 0 ? rest : undefined;
}
