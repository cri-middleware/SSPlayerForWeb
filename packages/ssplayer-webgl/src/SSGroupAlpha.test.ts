import { describe, expect, it } from 'vitest';
import { SSGroupAlpha } from './SSGroupAlpha.js';

/** A context that names its constants, answers everything, and records the state changes. */
function fakeGl(scissorOn: boolean) {
  const calls: string[] = [];
  let scissor = scissorOn;
  const gl = new Proxy({} as Record<string, unknown>, {
    get(_, key: string) {
      if (/^[A-Z0-9_]+$/.test(key)) return key;
      if (key === 'isEnabled') return () => scissor;
      if (key === 'enable') return (cap: string) => { if (cap === 'SCISSOR_TEST') scissor = true; calls.push(`enable ${cap}`); };
      if (key === 'disable') return (cap: string) => { if (cap === 'SCISSOR_TEST') scissor = false; calls.push(`disable ${cap}`); };
      if (key === 'blendEquationSeparate') return (a: string, b: string) => calls.push(`equation ${a} ${b}`);
      if (key === 'drawArrays') return () => calls.push(`draw scissor=${scissor}`);
      return () => ({});
    },
  });
  return { gl: gl as unknown as WebGLRenderingContext, calls };
}

describe('SSGroupAlpha', () => {
  it('composites inside the scissor of a clipped player', () => {
    const { gl, calls } = fakeGl(true);
    const group = new SSGroupAlpha(gl);
    group.begin(320, 240);
    expect(calls).toContain('disable SCISSOR_TEST');
    group.end(0.5);
    expect(calls).toContain('draw scissor=true');
  });

  it('leaves the scissor off for a player that does not clip', () => {
    const { gl, calls } = fakeGl(false);
    const group = new SSGroupAlpha(gl);
    group.begin(320, 240);
    group.end(0.5);
    expect(calls).toContain('draw scissor=false');
    expect(calls).not.toContain('enable SCISSOR_TEST');
  });

  it('composites with an additive equation, whatever the last batch left', () => {
    const { gl, calls } = fakeGl(false);
    const group = new SSGroupAlpha(gl);
    group.begin(320, 240);
    group.end(0.5);
    const equation = calls.indexOf('equation FUNC_ADD FUNC_ADD');
    expect(equation).toBeGreaterThanOrEqual(0);
    expect(equation).toBeLessThan(calls.indexOf('draw scissor=false'));
  });
});
