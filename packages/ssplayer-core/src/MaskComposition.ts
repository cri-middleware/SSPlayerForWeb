// Composition of mask settings down an instance-part hierarchy
// (09_mask.ja.md §2-6). When a part calls a sub-animation, the caller's mask
// settings do NOT replace the callee's, nor the other way round — they compose:
//
//   effective mask_influence      = caller's effective && own mask_influence
//   effective visible_inside_mask = caller's effective || own visible_inside_mask
//
// A "the callee wins if it has its own setting, otherwise inherit the caller's"
// fallback is neither operator and disagrees with SpriteStudio 7.5 in both
// directions; that was the defect this replaced.
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
 * AND-compose `mask_influence` (§2-6). Once a caller is not a mask target the
 * result is false for good — it can never return to true further down — so a
 * whole subtree below an opted-out instance part is settled as non-target.
 *
 * `mask_write` is deliberately not part of this: writing your own mask is a
 * local fact about one part, not something its descendants inherit.
 */
export function composeMaskInfluence(callerInfluence: boolean, partFlags: number): boolean {
    return callerInfluence && (partFlags & MASK_FLAG_MASK_INFLUENCE) !== 0;
}

/**
 * OR-compose `visible_inside_mask` (§2-6). Once any level asks to be drawn
 * inside the mask, everything below it is drawn inside too.
 */
export function composeVisibleInside(callerVisibleInside: boolean, partFlags: number): boolean {
    return callerVisibleInside || (partFlags & MASK_FLAG_VISIBLE_INSIDE) !== 0;
}
