import { describe, expect, it } from 'vitest';
import { MaskedPartsColorShader, MaskedPartsColorShaderWGSL } from './MaskedPartsColorShader.js';

/**
 * The coverage replay carries the same rule as the GPU-stencil path: invert and
 * increment must accumulate separately, because folding
 * them together makes an overlap of writers with differing mask_influence depend
 * on the order they were replayed in.
 *
 * These are source assertions — neither shader can be executed here, so they
 * pin the structure rather than the pixels. What they do catch is the exact
 * regression the split fixes: someone collapsing the two accumulators back into
 * one. Actual coverage still has to be confirmed against SpriteStudio 7.6 with
 * three overlapping writers (two only ever agree).
 */

const VARIANTS: Array<[string, string]> = [
  ['GLSL', MaskedPartsColorShader.fragment],
  ['WGSL', MaskedPartsColorShaderWGSL.fragment.source],
];

/** The body of maskPasses(), where the replay accumulates coverage. */
function replayBody(source: string): string {
  const start = source.indexOf('maskPasses(');
  expect(start).toBeGreaterThanOrEqual(0);
  const end = source.indexOf('visInside > 0.5', start);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe.each(VARIANTS)('%s coverage replay', (_name, source) => {
  const body = replayBody(source);

  it('accumulates the invert and increment ops in separate variables', () => {
    // The invert branch (m.w > 0.5) and the increment branch must not write the
    // same accumulator — that identity is the whole point of the split.
    expect(body).toMatch(/\bparity\b/);
    expect(body).toMatch(/\bcounter\b/);
    const invertBranch = body.slice(body.indexOf('m.w > 0.5'));
    expect(invertBranch).toMatch(/parity[\s\S]{0,40}?(?:\^|1\.0 -)/);
    expect(invertBranch).toMatch(/counter[\s\S]{0,20}?\+/);
  });

  it('unions the two planes for the final coverage test', () => {
    // Covered iff either plane is set: parity for the odd-overlap writers,
    // counter for the union writers.
    expect(body).toMatch(/parity[\s\S]{0,40}?\|\|[\s\S]{0,40}?counter/);
  });

  it('judges each writer on its interval of the tree sequence', () => {
    // open < seq, and seq < close unless close is the never-closing -1.
    expect(body).toMatch(/thisSeq > m\.x/);
    expect(body).toMatch(/m\.y < 0\.0\)?\s*\|\|\s*\(?thisSeq < m\.y/);
  });

  it('still tests a part when there is no writer at all', () => {
    // A part that draws only inside a mask draws nowhere without one, so a
    // writer count of 0 must not short-circuit to "pass".
    expect(body).not.toMatch(/writerCount (?:< 0\.5|== 0)\)\s*(?:\{\s*)?return true/);
  });

  it('no longer reconstructs a single 8-bit stencil value', () => {
    // The old single-accumulator form; its return would be order-dependent.
    expect(body).not.toMatch(/255\.0 - stencil/);
    expect(body).not.toMatch(/~stencil/);
  });
});
