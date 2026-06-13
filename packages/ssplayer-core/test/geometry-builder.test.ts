import { describe, it, expect } from 'vitest';
import { GeometryBuilder } from '../src/GeometryBuilder.js';

// Affine packed as [m00, m01, m10, m11, tx, ty]; a point (x, y) maps to
// (m00*x + m01*y + tx, m10*x + m11*y + ty). composeAffine(parent, child) must
// equal "apply child, then parent" — the transform used to place an
// instance-part child animation under its (possibly nested) parent.
type Affine = Float32Array;

function affine(m00: number, m01: number, m10: number, m11: number, tx: number, ty: number): Affine {
    return new Float32Array([m00, m01, m10, m11, tx, ty]);
}

function apply(m: ArrayLike<number>, x: number, y: number): [number, number] {
    return [m[0] * x + m[1] * y + m[4], m[2] * x + m[3] * y + m[5]];
}

const IDENTITY = affine(1, 0, 0, 1, 0, 0);
const SAMPLE_POINTS: [number, number][] = [
    [0, 0], [1, 0], [0, 1], [3, -7], [-12.5, 4.25], [100, 100],
];

describe('GeometryBuilder.composeAffine', () => {
    it('returns the child unchanged when parent is null (no out)', () => {
        const child = affine(2, 0, 0, 2, 5, 6);
        const r = GeometryBuilder.composeAffine(null, child);
        // Same reference (documented: returned directly, no allocation).
        expect(r).toBe(child);
    });

    it('copies the child into out when parent is null (with out)', () => {
        const child = affine(2, 0, 0, 2, 5, 6);
        const out = new Float32Array(6);
        const r = GeometryBuilder.composeAffine(null, child, out);
        expect(r).toBe(out);
        expect(Array.from(out)).toEqual(Array.from(child));
    });

    it('identity ∘ identity = identity', () => {
        const r = GeometryBuilder.composeAffine(IDENTITY, IDENTITY);
        expect(Array.from(r)).toEqual([1, 0, 0, 1, 0, 0]);
    });

    it('identity parent leaves the child transform intact', () => {
        const child = affine(0, -1, 1, 0, 10, 20); // rotate 90° + translate
        const r = GeometryBuilder.composeAffine(IDENTITY, child);
        for (const [x, y] of SAMPLE_POINTS) {
            expect(apply(r, x, y)).toEqual(apply(child, x, y));
        }
    });

    it('composes as parent(child(point)) for assorted affines', () => {
        const parents = [
            affine(1, 0, 0, 1, 30, -5),        // translate
            affine(2, 0, 0, 3, 0, 0),          // non-uniform scale
            affine(0, -1, 1, 0, 0, 0),         // rotate 90°
            affine(1.5, 0.5, -0.25, 2, 7, -3), // shear + translate
        ];
        const children = [
            affine(2, 0, 0, 2, 5, 6),
            affine(0.5, 0, 0, 0.5, -4, 8),
            affine(0, 1, -1, 0, 1, 1),
            affine(1, 0.3, 0.2, 1, -2, 9),
        ];
        for (const p of parents) {
            for (const c of children) {
                const composed = GeometryBuilder.composeAffine(p, c);
                for (const [x, y] of SAMPLE_POINTS) {
                    const [cx, cy] = apply(c, x, y);
                    const expected = apply(p, cx, cy);
                    const actual = apply(composed, x, y);
                    // 3-digit tolerance: the composed matrix is stored as
                    // Float32Array, so it carries one extra float32 rounding vs.
                    // the float64 reference. Any index/transpose bug would be
                    // off by whole units and still caught.
                    expect(actual[0]).toBeCloseTo(expected[0], 3);
                    expect(actual[1]).toBeCloseTo(expected[1], 3);
                }
            }
        }
    });

    it('writes the result into out and returns it', () => {
        const p = affine(2, 0, 0, 2, 1, 1);
        const c = affine(1, 0, 0, 1, 3, 4);
        const out = new Float32Array(6);
        const r = GeometryBuilder.composeAffine(p, c, out);
        expect(r).toBe(out);
        // 2x scale then +(1,1) translate, applied to child translate (3,4):
        // tx = 2*3 + 0*4 + 1 = 7 ; ty = 0*3 + 2*4 + 1 = 9
        expect(Array.from(out)).toEqual([2, 0, 0, 2, 7, 9]);
    });

    it('does not mutate the parent or child inputs', () => {
        const p = affine(2, 0, 0, 2, 1, 1);
        const c = affine(1, 0, 0, 1, 3, 4);
        const pCopy = Array.from(p);
        const cCopy = Array.from(c);
        GeometryBuilder.composeAffine(p, c, new Float32Array(6));
        expect(Array.from(p)).toEqual(pCopy);
        expect(Array.from(c)).toEqual(cCopy);
    });
});
