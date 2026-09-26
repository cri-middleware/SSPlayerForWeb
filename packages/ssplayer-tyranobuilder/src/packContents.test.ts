import { afterEach, describe, expect, it, vi } from 'vitest';
import { SSRuntimeManager, ssFormat } from '@spritestudio/ssplayer-core';
import { PART_TYPE_MASK, PART_TYPE_NORMAL, readPackContents } from './packContents.js';

describe('readPackContents', () => {
  afterEach(() => vi.restoreAllMocks());

  it('writes out the part types the core enum has', () => {
    expect(PART_TYPE_NORMAL).toBe(ssFormat.PartType.PartTypeNormal);
    expect(PART_TYPE_MASK).toBe(ssFormat.PartType.PartTypeMask);
  });

  it('offers a colour override on normal parts and a cell override on normal and mask parts', () => {
    vi.spyOn(SSRuntimeManager, 'extractParts').mockReturnValue([
      { name: 'body', type: ssFormat.PartType.PartTypeNormal },
      { name: 'window', type: ssFormat.PartType.PartTypeMask },
      { name: 'label', type: ssFormat.PartType.PartTypeText },
    ]);
    vi.spyOn(SSRuntimeManager, 'extractCellMapNames').mockReturnValue(['face']);
    vi.spyOn(SSRuntimeManager, 'extractCellNames').mockReturnValue(['smile', 'cry']);
    vi.spyOn(SSRuntimeManager, 'extractAnimationNames').mockReturnValue(['wait']);

    expect(readPackContents(new Uint8Array())).toEqual({
      animations: ['wait'],
      parts: [
        { name: 'body', takesColor: true, takesCell: true },
        { name: 'window', takesColor: false, takesCell: true },
        { name: 'label', takesColor: false, takesCell: false },
      ],
      cellmaps: { face: ['smile', 'cry'] },
    });
  });
});
