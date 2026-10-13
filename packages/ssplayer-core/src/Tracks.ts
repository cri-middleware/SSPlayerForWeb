/**
 * How a track folds onto the pose the tracks below it produced: `Mix` moves it
 * toward the track's own pose, `Additive` adds the track's offset from the
 * setup pose and leaves what is below showing through. The values are the
 * runtime's.
 */
export enum SSTrackBlend {
    Mix = 0,
    Additive = 1,
}

/**
 * Where an animation laid on a track starts: `Free` from the head of its
 * section, `Start` at the phase track 0's main animation stands at, so a run
 * laid over a walk keeps its stride. Matched once, when the animation is laid.
 * The values are the runtime's.
 */
export enum SSTrackSync {
    Free = 0,
    Start = 1,
}
