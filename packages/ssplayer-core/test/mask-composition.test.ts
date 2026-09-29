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
    instanceMaskInfluence,
    instanceVisibleInside,
} from '../src/MaskComposition.js';

/**
 * Instance-hierarchy mask composition. Neither side of an instance call wins
 * outright: the instance part and the sub-animation part are combined, with
 * AND for mask_influence and OR for visible_inside_mask. And only the instance
 * part directly above takes part — what it inherited itself does not chain
 * down (SpriteStudio 7.5). The tests cover the combinations where a "callee
 * wins" fallback, or a chained composition, would disagree.
 */

const INFLUENCE = MASK_FLAG_MASK_INFLUENCE;
const INSIDE = MASK_FLAG_VISIBLE_INSIDE;

/** A part's effective flags under a chain of instance parts (outermost first). */
function effectiveInfluence(instanceChain: number[], partFlags: number): boolean {
    const handedDown = instanceChain.length > 0
        ? instanceMaskInfluence(instanceChain[instanceChain.length - 1])
        : ROOT_MASK_INFLUENCE;
    return composeMaskInfluence(handedDown, partFlags);
}
function effectiveInside(instanceChain: number[], partFlags: number): boolean {
    const handedDown = instanceChain.length > 0
        ? instanceVisibleInside(instanceChain[instanceChain.length - 1])
        : ROOT_VISIBLE_INSIDE;
    return composeVisibleInside(handedDown, partFlags);
}

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

    it('a callee cannot opt back in under an opted-out instance part', () => {
        // The case a "callee wins" fallback gets wrong.
        expect(effectiveInfluence([0], INFLUENCE)).toBe(false);
    });

    it('takes only the instance part directly above', () => {
        // InstancePropagationTired3: the outer instance part opts out, the
        // inner one (Source01) opts in. The outer's own parts are unmasked,
        // the inner sub-animation's parts are masked — no chaining.
        expect(effectiveInfluence([0], INFLUENCE)).toBe(false);
        expect(effectiveInfluence([0, INFLUENCE], INFLUENCE)).toBe(true);
        // ...and the other way round, an opted-in outer does not rescue an
        // opted-out inner.
        expect(effectiveInfluence([INFLUENCE, 0], INFLUENCE)).toBe(false);
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

    it('a callee cannot force itself back outside under an inside instance part', () => {
        expect(effectiveInside([INSIDE], 0)).toBe(true);
    });

    it('takes only the instance part directly above', () => {
        expect(effectiveInside([INSIDE, 0], 0)).toBe(false);
        expect(effectiveInside([0, INSIDE], 0)).toBe(true);
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
        expect(instanceMaskInfluence(noise)).toBe(false);
        expect(instanceVisibleInside(noise)).toBe(false);
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
