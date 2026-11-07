// Composition of mask settings across an instance part.
// When a part calls a sub-animation, the caller's mask
// settings do NOT replace the callee's, nor the other way round — they compose:
//
//   effective mask_influence      = instance part's mask_influence && own mask_influence
//   effective visible_inside_mask = instance part's visible_inside_mask || own visible_inside_mask
//
// Only the instance part DIRECTLY above takes part, and it always does, whether
// or not anything above it masks. What that instance part itself inherited from
// further up does not chain down: SpriteStudio 7.6 draws a mask_influence == 0
// instance's own parts unmasked while the parts of the instances inside it are
// still judged on their own instance parts. Chaining the composed value down
// (AND- / OR-absorbing through every level) disagrees with that, and so does a
// "the callee wins if it has its own setting, otherwise inherit the caller's"
// fallback.
//
// The rule lives here rather than in each renderer because it is the same
// question everywhere: ssplayer-pixi clips against a coverage bitmap and
// ssplayer-webgl against the GPU stencil, but WHICH parts are targets, and with
// what polarity, does not depend on how the clipping is performed.
//
// These are free functions over booleans rather than a context object on
// purpose: they sit in the per-part draw loop, and returning a fresh object per
// instance part per frame would allocate in the hot path.

/** Static per-part mask flag bits, as packed by `getPartMaskFlags()`. */
export const MASK_FLAG_VISIBLE_INSIDE = 0x01;
export const MASK_FLAG_MASK_WRITE = 0x02;
export const MASK_FLAG_MASK_INFLUENCE = 0x04;
export const MASK_FLAG_DRAW_AS_MASK = 0x08;

/**
 * Identity for a top-level animation, i.e. one no instance part called.
 * `true` is AND's unit and `false` is OR's, so every part of a root animation
 * evaluates exactly by its own flags.
 */
export const ROOT_MASK_INFLUENCE = true;
export const ROOT_VISIBLE_INSIDE = false;

/**
 * The `mask_influence` an instance part hands to the sub-animation it calls:
 * its own flag and nothing it inherited. `mask_write` takes no part — writing
 * your own mask is a local fact about one part.
 */
export function instanceMaskInfluence(instancePartFlags: number): boolean {
    return (instancePartFlags & MASK_FLAG_MASK_INFLUENCE) !== 0;
}

/** The `visible_inside_mask` an instance part hands down: its own flag only. */
export function instanceVisibleInside(instancePartFlags: number): boolean {
    return (instancePartFlags & MASK_FLAG_VISIBLE_INSIDE) !== 0;
}

/**
 * AND-compose a part's `mask_influence` with what its instance part handed
 * down (`ROOT_MASK_INFLUENCE` at the root). This is both whether the part is a
 * mask target and, for a writer, which op it writes with (true = invert).
 */
export function composeMaskInfluence(callerInfluence: boolean, partFlags: number): boolean {
    return callerInfluence && (partFlags & MASK_FLAG_MASK_INFLUENCE) !== 0;
}

/**
 * OR-compose a part's `visible_inside_mask` with what its instance part
 * handed down (`ROOT_VISIBLE_INSIDE` at the root).
 */
export function composeVisibleInside(callerVisibleInside: boolean, partFlags: number): boolean {
    return callerVisibleInside || (partFlags & MASK_FLAG_VISIBLE_INSIDE) !== 0;
}
