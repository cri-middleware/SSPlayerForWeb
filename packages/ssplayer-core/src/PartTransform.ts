/**
 * Part-following transform types and helpers.
 *
 * The runtime already computes every part's world matrix each frame (for
 * drawing); this module is the engine-agnostic surface a renderer facade uses to
 * let an external object follow a part. The transform itself is read via
 * {@link InternalPlayerBase.getPartTransform}; this file only defines its shape
 * and the decomposition a facade needs when it drives a target component-wise.
 */

/**
 * A part's current-frame transform as a 2D affine, copied out of WASM memory
 * (safe to retain past the frame). Layout `[m00, m01, m10, m11, tx, ty]` — the
 * same interchange format as {@link SSRuntimeManager.getWorldMatrix2D} and
 * `GeometryBuilder.composeAffine`:
 *
 * ```
 * x' = m00 * x + m01 * y + tx
 * y' = m10 * x + m11 * y + ty
 * ```
 *
 * The space is animation-local and Y-down (the space parts are drawn in), so a
 * follower placed under the player's own transform lands exactly on the part.
 */
export type SSPartAffine = Float32Array; // length 6

/**
 * How a facade's part attachment follows its part. Engine-agnostic so the pixi
 * and rmmz facades share one option shape (the target object they drive is
 * engine-specific and lives on each facade's own attachment type).
 */
export interface SSPartFollowOptions {
    /** Drive the target's position from the part. Default true. */
    position?: boolean;
    /** Drive the target's rotation from the part. Default true. */
    rotation?: boolean;
    /** Drive the target's scale from the part. Default true. */
    scale?: boolean;
    /**
     * What to do on frames the part is hidden: `'follow'` keeps tracking it
     * (default), `'hide'` hides the target too. A part absent from the current
     * animation always hides the target regardless of this.
     */
    onHide?: 'follow' | 'hide';
    /**
     * Parent the target under the player so it inherits the player's own
     * transform and lands exactly on the part (default true). When false the
     * target is driven where it already lives — an exact match then only holds
     * while it shares the player's coordinate space.
     */
    addAsChild?: boolean;
}

/** A part affine decomposed into translation, rotation (radians) and scale. */
export interface SSDecomposedTransform {
    x: number;
    y: number;
    /** Rotation in radians, taken from the affine's X basis. */
    rotation: number;
    scaleX: number;
    scaleY: number;
}

/**
 * Decompose a 2D part affine `[m00, m01, m10, m11, tx, ty]` into translation,
 * rotation and scale, assuming a translate*rotate*scale composition. Rotation is
 * taken from the X basis and each scale from its basis length, with `scaleY`
 * signed by the affine's determinant so a mirrored (negatively scaled) part
 * survives the round-trip. A sheared affine cannot be represented this way and
 * is approximated — prefer the raw {@link SSPartAffine} when skew must be exact.
 */
export function decomposePartAffine(a: ArrayLike<number>): SSDecomposedTransform {
    const m00 = a[0], m01 = a[1], m10 = a[2], m11 = a[3];
    const scaleX = Math.hypot(m00, m10);
    let scaleY = Math.hypot(m01, m11);
    // A negative determinant means the basis is mirrored; fold that sign into
    // scaleY (matching the convention getWorldMatrix2D → set*Scale expects).
    if (m00 * m11 - m01 * m10 < 0) scaleY = -scaleY;
    return {
        x: a[4],
        y: a[5],
        rotation: Math.atan2(m10, m00),
        scaleX,
        scaleY,
    };
}
