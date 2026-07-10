import { describe, it, expect } from 'vitest';
import { resolveRelativePath, sortByPath, type DroppedFile } from './dropHelpers';

// Build a DroppedFile from just a path; these helpers only look at `path`.
const df = (path: string): DroppedFile => ({ file: { name: path } as File, path });

describe('resolveRelativePath', () => {
  it('joins a plain relative path onto the base directory', () => {
    expect(resolveRelativePath('anime', 'textures/common.png')).toBe('anime/textures/common.png');
  });

  it('walks up with ".." segments', () => {
    expect(resolveRelativePath('anime/data', '../textures/common.png')).toBe('anime/textures/common.png');
  });

  it('resolves multiple ".." segments', () => {
    expect(resolveRelativePath('a/b/c', '../../x.png')).toBe('a/x.png');
  });

  it('ignores "." and empty segments', () => {
    expect(resolveRelativePath('a/b', './/c.png')).toBe('a/b/c.png');
  });

  it('handles an empty base directory', () => {
    expect(resolveRelativePath('', 'common.png')).toBe('common.png');
  });
});

describe('sortByPath', () => {
  it('orders shallow entries before deeper ones under the same prefix', () => {
    const sorted = sortByPath([df('a/y'), df('a')]).map((f) => f.path);
    expect(sorted).toEqual(['a', 'a/y']);
  });

  it('sorts lexicographically across siblings', () => {
    const sorted = sortByPath([df('b/x'), df('a/y'), df('a')]).map((f) => f.path);
    expect(sorted).toEqual(['a', 'a/y', 'b/x']);
  });

  it('does not mutate the input array', () => {
    const input = [df('b'), df('a')];
    const snapshot = input.map((f) => f.path);
    sortByPath(input);
    expect(input.map((f) => f.path)).toEqual(snapshot);
  });
});
