import { describe, expect, it } from 'vitest';
import {
    MASK_FLAG_DRAW_AS_MASK,
    MASK_FLAG_MASK_INFLUENCE,
    MASK_FLAG_MASK_WRITE,
    MASK_FLAG_VISIBLE_INSIDE,
    ROOT_MASK_INFLUENCE,
    ROOT_VISIBLE_INSIDE,
    composeMaskInfluence,
    composeVisibleInside,
} from '../src/MaskComposition.js';

/**
 * Instance-hierarchy mask composition. The rule that
 * matters is that neither side of an instance call wins outright: the caller
 * and the callee are combined, with AND for mask_influence and OR for
 * visible_inside_mask. The defect these replaced was a "callee wins if it has
 * its own setting, else inherit the caller's" fallback — which happens to agree
 * with both operators in the easy cases and disagree in the interesting ones,
 * so the tests below deliberately cover the disagreeing combinations.
 */

const INFLUENCE = MASK_FLAG_MASK_INFLUENCE;
const INSIDE = MASK_FLAG_VISIBLE_INSIDE;

describe('mask_influence composes with AND', () => {
    it('lets a root animation decide by its own flag', () => {
        expect(composeMaskInfluence(ROOT_MASK_INFLUENCE, INFLUENCE)).toBe(true);
        expect(composeMaskInfluence(ROOT_MASK_INFLUENCE, 0)).toBe(false);
    });

    it('requires both sides', () => {
        expect(composeMaskInfluence(true, INFLUENCE)).toBe(true);
        expect(composeMaskInfluence(true, 0)).toBe(false);
        expect(composeMaskInfluence(false, INFLUENCE)).toBe(false);
        expect(composeMaskInfluence(false, 0)).toBe(false);
    });

    it('is absorbing once false — a callee cannot opt back in', () => {
        // The case a "callee wins" fallback gets wrong: the sub-animation part
        // asks to be masked, but its caller already opted the subtree out.
        expect(composeMaskInfluence(false, INFLUENCE)).toBe(false);
        // ...and it stays false however deep the nesting goes.
        let influence = composeMaskInfluence(true, 0);
        for (let depth = 0; depth < 4; depth++) {
            influence = composeMaskInfluence(influence, INFLUENCE);
        }
        expect(influence).toBe(false);
    });
});

describe('visible_inside_mask composes with OR', () => {
    it('lets a root animation decide by its own flag', () => {
        expect(composeVisibleInside(ROOT_VISIBLE_INSIDE, INSIDE)).toBe(true);
        expect(composeVisibleInside(ROOT_VISIBLE_INSIDE, 0)).toBe(false);
    });

    it('takes either side', () => {
        expect(composeVisibleInside(true, INSIDE)).toBe(true);
        expect(composeVisibleInside(true, 0)).toBe(true);
        expect(composeVisibleInside(false, INSIDE)).toBe(true);
        expect(composeVisibleInside(false, 0)).toBe(false);
    });

    it('is absorbing once true — a callee cannot force itself back outside', () => {
        // The mirror case a "callee wins" fallback gets wrong: the caller asked
        // for inside, the sub-animation part says outside, and OR keeps inside.
        expect(composeVisibleInside(true, 0)).toBe(true);
        let inside = composeVisibleInside(false, INSIDE);
        for (let depth = 0; depth < 4; depth++) {
            inside = composeVisibleInside(inside, 0);
        }
        expect(inside).toBe(true);
    });
});

describe('composition inputs', () => {
    it('ignores mask_write and draw_as_mask', () => {
        // mask_write is a local fact about the part that writes it, never
        // inherited; draw_as_mask concerns being a writer, not a target.
        const noise = MASK_FLAG_MASK_WRITE | MASK_FLAG_DRAW_AS_MASK;
        expect(composeMaskInfluence(true, noise)).toBe(false);
        expect(composeVisibleInside(false, noise)).toBe(false);
        expect(composeMaskInfluence(true, noise | INFLUENCE)).toBe(true);
        expect(composeVisibleInside(false, noise | INSIDE)).toBe(true);
    });

    it('uses the identity element of each operator at the root', () => {
        // Wrong identities would silently re-interpret every top-level animation.
        expect(ROOT_MASK_INFLUENCE).toBe(true);   // AND's unit
        expect(ROOT_VISIBLE_INSIDE).toBe(false);  // OR's unit
    });

    it('keeps the four flag bits distinct', () => {
        const bits = [MASK_FLAG_VISIBLE_INSIDE, MASK_FLAG_MASK_WRITE, MASK_FLAG_MASK_INFLUENCE, MASK_FLAG_DRAW_AS_MASK];
        expect(new Set(bits).size).toBe(bits.length);
        expect(bits.reduce((a, b) => a | b, 0)).toBe(0x0F);
    });
});
