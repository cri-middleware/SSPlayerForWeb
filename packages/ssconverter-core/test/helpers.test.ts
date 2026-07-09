import { describe, it, expect } from 'vitest';
import { locateProject, applySuffix } from '../src/index.js';

describe('locateProject', () => {
  it('derives stem and dir for a nested .sspj', () => {
    const loc = locateProject(['assets/char/hero.sspj', 'assets/char/hero.png']);
    expect(loc).toEqual({
      sspjPath: 'assets/char/hero.sspj',
      stem: 'hero',
      dir: ['assets', 'char'],
    });
  });

  it('returns an empty dir for a root-level .sspj', () => {
    expect(locateProject(['hero.sspj', 'hero.png']).dir).toEqual([]);
  });

  it('matches .sspj case-insensitively', () => {
    expect(locateProject(['Hero.SSPJ']).stem).toBe('Hero');
  });

  it('throws when no .sspj is present', () => {
    expect(() => locateProject(['hero.png', 'anim.ssae'])).toThrow(/No \.sspj/);
  });

  it('throws when more than one .sspj is present (ambiguous)', () => {
    expect(() => locateProject(['a.sspj', 'b.sspj'])).toThrow(/Found 2 \.sspj/);
  });
});

describe('applySuffix', () => {
  const bytes = (n: number) => new Uint8Array([n]);

  it('renames .ssab basenames and drops non-.ssab output', () => {
    const heroBytes = bytes(1);
    const out = new Map<string, Uint8Array>([
      ['hero.ssab', heroBytes],
      ['hero_tyu.ssab', bytes(2)],
      ['hero.ssqb', bytes(3)],
      ['hero.png', bytes(4)],
    ]);
    const result = applySuffix(out, '_embedded');
    expect([...result.keys()].sort()).toEqual([
      'hero_embedded.ssab',
      'hero_tyu_embedded.ssab',
    ]);
    // Bytes are carried through by reference, not copied.
    expect(result.get('hero_embedded.ssab')).toBe(heroBytes);
  });

  it('preserves directory prefixes when renaming', () => {
    const out = new Map([['sub/hero.ssab', bytes(1)]]);
    expect([...applySuffix(out, '_x').keys()]).toEqual(['sub/hero_x.ssab']);
  });

  it('matches .ssab case-insensitively', () => {
    const out = new Map([['hero.SSAB', bytes(1)]]);
    expect([...applySuffix(out, '_x').keys()]).toEqual(['hero_x.ssab']);
  });
});
