import { describe, expect, it } from 'vitest';
import { decomposePartAffine, type SSPartAffine } from '../src/PartTransform.js';

// decomposePartAffine turns the [m00, m01, m10, m11, tx, ty] affine that
// getPartTransform returns into the components a facade writes when it drives a
// target on a subset of axes. It assumes translate*rotate*scale (SpriteStudio's
// TRS parts), so these cases pin the rotation/scale/mirror conventions the
// renderers rely on. Affine convention:
//   x' = m00*x + m01*y + tx   (first column [m00, m10] is the X basis)
//   y' = m10*x + m11*y + ty
const affine = (m00: number, m01: number, m10: number, m11: number, tx = 0, ty = 0): SSPartAffine =>
    new Float32Array([m00, m01, m10, m11, tx, ty]);

const HALF_PI = Math.PI / 2;

describe('decomposePartAffine', () => {
    it('reads translation straight from the affine', () => {
        const d = decomposePartAffine(affine(1, 0, 0, 1, 12.5, -7.25));
        expect(d.x).toBe(12.5);
        expect(d.y).toBe(-7.25);
    });

    it('returns identity for the identity affine', () => {
        const d = decomposePartAffine(affine(1, 0, 0, 1));
        expect(d.rotation).toBe(0);
        expect(d.scaleX).toBeCloseTo(1);
        expect(d.scaleY).toBeCloseTo(1);
    });

    it('takes rotation from the X basis (+90°)', () => {
        // rotate(+90°): [[cos, -sin], [sin, cos]] = [[0, -1], [1, 0]].
        const d = decomposePartAffine(affine(0, -1, 1, 0));
        expect(d.rotation).toBeCloseTo(HALF_PI);
        expect(d.scaleX).toBeCloseTo(1);
        expect(d.scaleY).toBeCloseTo(1);
    });

    it('recovers non-uniform scale', () => {
        const d = decomposePartAffine(affine(3, 0, 0, 2));
        expect(d.rotation).toBeCloseTo(0);
        expect(d.scaleX).toBeCloseTo(3);
        expect(d.scaleY).toBeCloseTo(2);
    });

    it('folds a mirror (negative determinant) into scaleY', () => {
        // Horizontal flip: X basis unchanged, Y basis negated → det < 0.
        const d = decomposePartAffine(affine(1, 0, 0, -1));
        expect(d.scaleX).toBeCloseTo(1);
        expect(d.scaleY).toBeCloseTo(-1);
        expect(d.rotation).toBeCloseTo(0);
    });

    it('composes rotation and scale together', () => {
        // rotate(+90°) then scale(2, 4): X basis = 2*(0,1), Y basis = 4*(-1,0).
        const d = decomposePartAffine(affine(0, -4, 2, 0));
        expect(d.rotation).toBeCloseTo(HALF_PI);
        expect(d.scaleX).toBeCloseTo(2);
        expect(d.scaleY).toBeCloseTo(4);
    });
});
