import { describe, expect, it, vi } from 'vitest';

const convert = vi.fn();
vi.mock('../wasm/ssconverter.js', () => ({
  default: vi.fn(),
  convert: (...args: unknown[]) => convert(...args),
  version: vi.fn(),
  ssab_schema_version: vi.fn(),
  ssqb_schema_version: vi.fn(),
}));

import { convertProject } from '../src/index.js';

describe('convertProject', () => {
  it('hands the converter names in NFC, as the project files write them', () => {
    convert.mockReturnValueOnce({});
    const nfd = 'がぎぐ.png'.normalize('NFD');
    convertProject(new Map([[nfd, new Uint8Array([1])]]));
    expect([...(convert.mock.calls[0][0] as Map<string, Uint8Array>).keys()]).toEqual(['がぎぐ.png'.normalize('NFC')]);
  });

  it('throws an Error when the converter throws a string', () => {
    convert.mockImplementationOnce(() => {
      throw 'SSPJ Parse Error';
    });
    expect(() => convertProject(new Map())).toThrow(new Error('SSPJ Parse Error'));
  });
});
