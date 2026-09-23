import { describe, expect, it } from 'vitest';
import { MASK_PLANE_COUNTER, MASK_PLANE_PARITY, maskPlaneForOp } from './SSWebGLRenderer.js';

/**
 * The stencil bit-plane split. INVERT and INCR/DECR are
 * each self-inverse but do not commute, so if they ever share a bit again the
 * failure is silent and data-dependent: coverage flips with the order the
 * writers happened to be drawn in, and the cancelling pass leaves residue that
 * bleeds into every part drawn afterwards. These assertions pin the properties
 * that make each plane closed, so a future edit to the masks has to break one
 * of them out loud.
 */

// Real WebGL enum values, so the op→plane mapping is exercised the way the
// renderer calls it rather than against invented sentinels.
const gl = {
  INVERT: 0x150A,
  INCR_WRAP: 0x8507,
  DECR_WRAP: 0x8508,
  INCR: 0x1E02,
  DECR: 0x1E03,
} as unknown as WebGLRenderingContext;

describe('mask stencil bit planes', () => {
  it('gives the two ops disjoint bits', () => {
    expect(MASK_PLANE_PARITY & MASK_PLANE_COUNTER).toBe(0);
  });

  it('keeps the parity plane exactly one bit wide', () => {
    // Invert only ever toggles; a wider plane would waste counter range.
    expect(MASK_PLANE_PARITY & (MASK_PLANE_PARITY - 1)).toBe(0);
    expect(MASK_PLANE_PARITY).not.toBe(0);
  });

  it('keeps the counter plane contiguous from bit 0', () => {
    // Increment/decrement are ordinary arithmetic, so the counter has to start
    // at bit 0 with no holes for its carry and borrow to behave.
    expect(MASK_PLANE_COUNTER & (MASK_PLANE_COUNTER + 1)).toBe(0);
    expect(MASK_PLANE_COUNTER & 1).toBe(1);
  });

  it('spans the whole byte the test side reads', () => {
    // Together the planes are the coverage the masked-content test compares
    // against 0 with a 0xFF read mask — their union is the specified coverage
    // when writers of differing mask_influence overlap.
    expect(MASK_PLANE_PARITY | MASK_PLANE_COUNTER).toBe(0xFF);
  });

  it('routes invert to parity and the wrapping counter ops to the counter', () => {
    expect(maskPlaneForOp(gl, gl.INVERT)).toBe(MASK_PLANE_PARITY);
    expect(maskPlaneForOp(gl, gl.INCR_WRAP)).toBe(MASK_PLANE_COUNTER);
    expect(maskPlaneForOp(gl, gl.DECR_WRAP)).toBe(MASK_PLANE_COUNTER);
  });

  it('never routes two different ops onto one plane', () => {
    // The saturating INCR/DECR are not used (they would clamp the carry the
    // plane relies on dropping), but if one is reintroduced it must still land
    // on the counter and never on parity.
    for (const op of [gl.INCR, gl.DECR]) {
      expect(maskPlaneForOp(gl, op)).toBe(MASK_PLANE_COUNTER);
    }
  });
});
