// What the inspector's pickers offer for one pack, read out of the `.ssab`
// itself — the artefact the runtime will load, so the only honest source for
// what the tags can name.

import { SSRuntimeManager } from '@spritestudio/ssplayer-core';

/**
 * One part of a pack, and which overrides the runtime applies to it. Decided
 * here, where the part types are known, so the components stay plain data.
 */
export interface PackPart {
  name: string;
  /** `[ss_part_color]`: normal parts only. */
  takesColor: boolean;
  /** `[ss_part_cell]`: normal and mask parts. */
  takesCell: boolean;
}

export interface PackContents {
  animations: string[];
  /** Every part, in table order. */
  parts: PackPart[];
  /** Cell map name (no `.ssce`) → the cells in it. */
  cellmaps: Record<string, string[]>;
}

export const EMPTY_PACK: PackContents = { animations: [], parts: [], cellmaps: {} };

// `ssFormat.PartType.PartTypeNormal` / `PartTypeMask`. The enum is reachable
// only through the `ssFormat` namespace, and reading a value off it pulls every
// generated class into this bundle — about 50 KB of a file that ships inside
// every exported game — so the two values are written out and a test pins them.
export const PART_TYPE_NORMAL = 2;
export const PART_TYPE_MASK = 12;

/**
 * Read `bytes` as a pack. Anything that is not one reads as empty rather than
 * throwing — the core's extractors behave the same way — since an empty picker
 * with its free-form fallback is the right answer to a half-written file.
 */
export function readPackContents(bytes: Uint8Array): PackContents {
  const cellmaps: Record<string, string[]> = {};
  for (const map of SSRuntimeManager.extractCellMapNames(bytes)) {
    cellmaps[map] = SSRuntimeManager.extractCellNames(bytes, map);
  }
  return {
    animations: SSRuntimeManager.extractAnimationNames(bytes),
    parts: SSRuntimeManager.extractParts(bytes).map(({ name, type }) => ({
      name,
      takesColor: type === PART_TYPE_NORMAL,
      takesCell: type === PART_TYPE_NORMAL || type === PART_TYPE_MASK,
    })),
    cellmaps,
  };
}
