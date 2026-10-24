/**
 * A part's outline as drawn: what {@link InternalPlayerBase.getPartQuad}
 * reports and {@link InternalPlayerBase.hitTestPart} tests against.
 */

/**
 * Four corners `[ltx, lty, rtx, rty, lbx, lby, rbx, rby]` in animation-local
 * (Y-down) space, the space {@link InternalPlayerBase.getPartTransform}
 * reports. Four points rather than a box, because a rotated, skewed or
 * vertex-deformed part is not axis-aligned. The corners are the part's own —
 * `lt` is where the cell's top left is drawn — so a rotated or flipped part
 * has them wherever the pose put them.
 */
export type SSPartQuad = Float32Array; // length 8

/**
 * Whether `(x, y)` lies inside the outline `lt → rt → rb → lb` of `quad`, by
 * the even-odd rule, so a deform that folds the quad over itself still
 * answers.
 */
export function partQuadContains(quad: ArrayLike<number>, x: number, y: number): boolean {
    const ltx = quad[0], lty = quad[1], rtx = quad[2], rty = quad[3];
    const lbx = quad[4], lby = quad[5], rbx = quad[6], rby = quad[7];
    let inside = false;
    if (crosses(ltx, lty, lbx, lby, x, y)) inside = !inside;
    if (crosses(rtx, rty, ltx, lty, x, y)) inside = !inside;
    if (crosses(rbx, rby, rtx, rty, x, y)) inside = !inside;
    if (crosses(lbx, lby, rbx, rby, x, y)) inside = !inside;
    return inside;
}

function crosses(ax: number, ay: number, bx: number, by: number, x: number, y: number): boolean {
    return (ay > y) !== (by > y) && x < ((bx - ax) * (y - ay)) / (by - ay) + ax;
}
