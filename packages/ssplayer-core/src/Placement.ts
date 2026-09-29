/**
 * Fit and align: where an animation's box lands in a view.
 *
 * Pure arithmetic over a box and a view size, so it needs no renderer and every
 * renderer shares one copy. The names, defaults and arithmetic are the porting
 * guide's Placement page.
 */

/**
 * How the box is scaled to the view — `<img>`'s `object-fit` words. `none` is no
 * fit at all: scale 1, origin at the view's centre.
 */
export type SSFit = 'contain' | 'cover' | 'none';

/** Which point of the box lands on the matching point of the view. */
export type SSAlign =
    | 'center'
    | 'top'
    | 'bottom'
    | 'left'
    | 'right'
    | 'top-left'
    | 'top-right'
    | 'bottom-left'
    | 'bottom-right';

/** A box in player-local units, Y down. */
export interface SSPlacementBox {
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface SSPlacementOptions {
    /** Default `contain`. */
    fit?: SSFit;
    /** Default `center`. */
    align?: SSAlign;
    /**
     * The box to fit. Omitted, the animation's authored canvas
     * ({@link InternalPlayerBase.getCanvasRect}).
     */
    frame?: SSPlacementBox;
    /** The player's own mirrors: alignment follows them, so they are input here. */
    flipX?: boolean;
    flipY?: boolean;
}

/**
 * Where the animation's origin sits in the view (`x`, `y`, from the view's
 * top-left, Y down) and the scale the fit chose. The draw maps
 * `p -> origin + scale * p`.
 */
export interface SSPlacement {
    x: number;
    y: number;
    scale: number;
}

/** The horizontal half of an {@link SSAlign}: -1 left, 0 centre, 1 right. */
function alignX(align: SSAlign): -1 | 0 | 1 {
    if (align === 'left' || align === 'top-left' || align === 'bottom-left') return -1;
    if (align === 'right' || align === 'top-right' || align === 'bottom-right') return 1;
    return 0;
}

/** The vertical half, in screen terms: -1 is the top of the view. */
function alignY(align: SSAlign): -1 | 0 | 1 {
    if (align === 'top' || align === 'top-left' || align === 'top-right') return -1;
    if (align === 'bottom' || align === 'bottom-left' || align === 'bottom-right') return 1;
    return 0;
}

/**
 * One axis: where the origin must sit for the box's mapped extent to land against
 * `side` of a `viewSize`-long view. `s` is the signed scale for the axis, so a
 * flip swaps which end of the box is the low one and the anchor follows it; the
 * centre comes out the same either way.
 */
function solveAxis(viewSize: number, s: number, lo: number, size: number, side: -1 | 0 | 1): number {
    if (side === 0) return viewSize / 2 - s * (lo + size / 2);
    const lowEdge = s > 0 ? lo : lo + size;
    const highEdge = s > 0 ? lo + size : lo;
    return side < 0 ? -s * lowEdge : viewSize - s * highEdge;
}

/**
 * Put `box` into a `viewWidth` x `viewHeight` view.
 *
 * An absent or zero-sized box, or a zero-sized view, leaves nothing to divide
 * by: the fit is skipped and the result is the unfitted placement — scale 1,
 * origin at the view's centre — as `fit: 'none'` gives, not an error.
 */
export function resolvePlacement(
    box: SSPlacementBox | null | undefined,
    viewWidth: number,
    viewHeight: number,
    options: SSPlacementOptions = {},
): SSPlacement {
    const { fit = 'contain', align = 'center', flipX = false, flipY = false } = options;

    if (fit === 'none' || !box || !(box.width > 0) || !(box.height > 0) || !(viewWidth > 0) || !(viewHeight > 0)) {
        return { x: viewWidth / 2, y: viewHeight / 2, scale: 1 };
    }

    const sx = viewWidth / box.width;
    const sy = viewHeight / box.height;
    const scale = fit === 'cover' ? Math.max(sx, sy) : Math.min(sx, sy);
    return {
        x: solveAxis(viewWidth, flipX ? -scale : scale, box.x, box.width, alignX(align)),
        y: solveAxis(viewHeight, flipY ? -scale : scale, box.y, box.height, alignY(align)),
        scale,
    };
}

/**
 * The authored canvas as a box in player-local units, Y down.
 *
 * `pivot` is normalised from the canvas centre in editor space (Y up), so a
 * character standing on its origin — pivot `(0, -0.5)` — gets a box wholly above
 * it.
 */
export function canvasRectFrom(width: number, height: number, pivotX: number, pivotY: number): SSPlacementBox {
    return {
        x: -pivotX * width - width / 2,
        y: pivotY * height - height / 2,
        width,
        height,
    };
}
