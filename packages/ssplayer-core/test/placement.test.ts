import { describe, expect, it } from 'vitest';
import { canvasRectFrom, resolvePlacement, type SSAlign, type SSPlacement, type SSPlacementBox, type SSPlacementOptions } from '../src/Placement.js';

/** A 100x100 box at the origin, in player-local units (Y down). */
const BOX: SSPlacementBox = { x: 0, y: 0, width: 100, height: 100 };
/** Same size but off the origin, so a fit that ignores `box.x/y` shows. */
const OFFSET_BOX: SSPlacementBox = { x: -40, y: 10, width: 100, height: 100 };

/**
 * Where the box lands in the view. The draw maps `p -> origin + s * p`, so this is
 * what the placement is *for*; asserting on it rather than on the raw origin is
 * what keeps a flip case readable — under a mirror the origin moves to the other
 * end of the extent while the extent itself is what has to hold.
 */
function extent(t: SSPlacement, box: SSPlacementBox, flipX = false, flipY = false) {
    const sx = flipX ? -t.scale : t.scale;
    const sy = flipY ? -t.scale : t.scale;
    const xs = [t.x + sx * box.x, t.x + sx * (box.x + box.width)];
    const ys = [t.y + sy * box.y, t.y + sy * (box.y + box.height)];
    return { left: Math.min(...xs), right: Math.max(...xs), top: Math.min(...ys), bottom: Math.max(...ys) };
}

const place = (box: SSPlacementBox | null | undefined, w: number, h: number, o: SSPlacementOptions = {}) =>
    resolvePlacement(box, w, h, o);

describe('resolvePlacement: the fit', () => {
    it('contains by the tighter axis', () => {
        expect(place(BOX, 200, 100).scale).toBe(1);
    });

    it('covers by the looser axis', () => {
        expect(place(BOX, 200, 100, { fit: 'cover' }).scale).toBe(2);
    });

    it('defaults to contain', () => {
        expect(place(BOX, 200, 100).scale).toBe(place(BOX, 200, 100, { fit: 'contain' }).scale);
    });

    it('fills the view on the tight axis when contained', () => {
        const e = extent(place(BOX, 200, 100), BOX);
        expect(e.top).toBeCloseTo(0);
        expect(e.bottom).toBeCloseTo(100);
    });

    it('measures from the box\'s own origin, not from zero', () => {
        expect(place(OFFSET_BOX, 200, 100).scale).toBe(place(BOX, 200, 100).scale);
        const e = extent(place(OFFSET_BOX, 200, 100), OFFSET_BOX);
        expect((e.left + e.right) / 2).toBeCloseTo(100);
        expect((e.top + e.bottom) / 2).toBeCloseTo(50);
    });
});

describe('resolvePlacement: nothing to fit', () => {
    const unfitted = { x: 100, y: 50, scale: 1 };

    it('fit: none is scale 1 at the view\'s centre', () => {
        expect(place(BOX, 200, 100, { fit: 'none' })).toEqual(unfitted);
    });

    it.each([
        ['null', null],
        ['undefined', undefined],
        ['zero width', { x: 0, y: 0, width: 0, height: 100 }],
        ['zero height', { x: 0, y: 0, width: 100, height: 0 }],
    ] as const)('returns the unfitted placement for a %s box', (_label, box) => {
        expect(place(box, 200, 100)).toEqual(unfitted);
    });

    it.each([
        ['zero width', 0, 100],
        ['zero height', 200, 0],
    ])('returns the unfitted placement for a view of %s', (_label, w, h) => {
        const t = place(BOX, w, h);
        expect(t).toEqual({ x: w / 2, y: h / 2, scale: 1 });
        expect(Number.isFinite(t.scale)).toBe(true);
    });
});

describe('resolvePlacement: align', () => {
    // A 200x100 view and a 100x100 box contained at scale 1: 100px of slack on X,
    // none on Y, so the horizontal half of every align is what moves.
    const cases: Array<[SSAlign, number, number]> = [
        ['center', 50, 150],
        ['left', 0, 100],
        ['right', 100, 200],
        ['top-left', 0, 100],
        ['bottom-left', 0, 100],
        ['top-right', 100, 200],
        ['bottom-right', 100, 200],
        ['top', 50, 150],
        ['bottom', 50, 150],
    ];

    it.each(cases)('%s puts the box at [%d, %d] horizontally', (align, left, right) => {
        const e = extent(place(BOX, 200, 100, { align }), BOX);
        expect(e.left).toBeCloseTo(left);
        expect(e.right).toBeCloseTo(right);
    });

    it('aligns the vertical half in screen terms: top is the top of the view', () => {
        // 100x200, so the slack is on Y this time.
        const top = extent(place(BOX, 100, 200, { align: 'top' }), BOX);
        const bottom = extent(place(BOX, 100, 200, { align: 'bottom' }), BOX);
        expect(top.top).toBeCloseTo(0);
        expect(bottom.bottom).toBeCloseTo(200);
    });

    it('aligns a box that does not start at the origin by its edges', () => {
        expect(extent(place(OFFSET_BOX, 200, 100, { align: 'left' }), OFFSET_BOX).left).toBeCloseTo(0);
    });
});

describe('resolvePlacement: flip', () => {
    it('leaves a centred box where it was', () => {
        const plain = extent(place(OFFSET_BOX, 200, 100), OFFSET_BOX);
        const mirrored = extent(place(OFFSET_BOX, 200, 100, { flipX: true, flipY: true }), OFFSET_BOX, true, true);
        expect(mirrored.left).toBeCloseTo(plain.left);
        expect(mirrored.right).toBeCloseTo(plain.right);
        expect(mirrored.top).toBeCloseTo(plain.top);
        expect(mirrored.bottom).toBeCloseTo(plain.bottom);
    });

    // A mirror swaps which end of the box is the low one, and `left` still has to
    // mean the left of the view.
    it('keeps an edge-aligned box against that edge', () => {
        const left = place(OFFSET_BOX, 200, 100, { align: 'left', flipX: true });
        expect(extent(left, OFFSET_BOX, true).left).toBeCloseTo(0);
        const right = place(OFFSET_BOX, 200, 100, { align: 'right', flipX: true });
        expect(extent(right, OFFSET_BOX, true).right).toBeCloseTo(200);
        const top = place(OFFSET_BOX, 100, 200, { align: 'top', flipY: true });
        expect(extent(top, OFFSET_BOX, false, true).top).toBeCloseTo(0);
        const bottom = place(OFFSET_BOX, 100, 200, { align: 'bottom', flipY: true });
        expect(extent(bottom, OFFSET_BOX, false, true).bottom).toBeCloseTo(200);
    });
});

describe('canvasRectFrom', () => {
    it('centres the canvas on the origin for a pivot of (0, 0)', () => {
        expect(canvasRectFrom(800, 600, 0, 0)).toEqual({ x: -400, y: -300, width: 800, height: 600 });
    });

    it('puts a character standing on its origin wholly above it', () => {
        // Pivot (0, -0.5) is the canvas's bottom edge in editor space (Y up).
        const box = canvasRectFrom(800, 600, 0, -0.5);
        expect(box.y + box.height).toBeCloseTo(0);
        expect(box.x).toBeCloseTo(-400);
    });

    it('shifts the box against the pivot on X', () => {
        expect(canvasRectFrom(800, 600, 0.5, 0).x).toBeCloseTo(-800);
    });
});
