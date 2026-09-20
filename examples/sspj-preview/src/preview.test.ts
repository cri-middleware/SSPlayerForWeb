// What this page claims, checked outside a browser.
//
// Two halves. The file collection is pure and is tested directly. The
// conversion is the part the page's whole premise rests on — that a project
// dropped in a tab becomes a pack the player can read with no server and no
// sibling files — so it runs the real wasm over a real project from the SDK
// and reads the result back with the runtime's own accessor.
//
// What it cannot cover is the drawing, and `DataTransfer` — a browser is the
// only place either exists.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import * as nodePath from 'node:path';
import { fileURLToPath } from 'node:url';

import { convertProject, init } from '@spritestudio/ssconverter-core';
import { SSRuntimeManager } from '@spritestudio/ssplayer-core';
import { describe, expect, it } from 'vitest';

import { findProjects, readProject, type ProjectFile } from './projectDrop.js';

const here = nodePath.dirname(fileURLToPath(import.meta.url));
const repoRoot = nodePath.resolve(here, '../../..');
const WASM = nodePath.join(repoRoot, 'packages/ssconverter-core/wasm/ssconverter_bg.wasm');
const SAMPLE = nodePath.join(repoRoot, 'SpriteStudio-SDK/tests/Ringo');

/** A dropped folder, built from a real one on disk. */
function asDropped(dir: string, prefix: string): ProjectFile[] {
  const files: ProjectFile[] = [];
  for (const name of readdirSync(dir)) {
    if (name.startsWith('.')) continue;
    const full = nodePath.join(dir, name);
    const path = `${prefix}/${name}`;
    if (statSync(full).isDirectory()) files.push(...asDropped(full, path));
    else files.push({ file: new File([readFileSync(full)], name), path });
  }
  return files;
}

describe('findProjects', () => {
  const files: ProjectFile[] = [
    { file: new File([], 'a'), path: 'deep/inner/Two.sspj' },
    { file: new File([], 'b'), path: 'deep/One.sspj' },
    { file: new File([], 'c'), path: 'deep/One.ssae' },
  ];

  it('finds every .sspj, shallowest first', () => {
    // The page converts the first and offers the rest, so "first" has to be
    // the one someone dropping a project folder meant.
    expect(findProjects(files).map((p) => p.path)).toEqual([
      'deep/One.sspj',
      'deep/inner/Two.sspj',
    ]);
  });

  it('carries the folder each one sits in', () => {
    const [outer, inner] = findProjects(files);
    expect(outer).toMatchObject({ dir: 'deep', stem: 'One' });
    expect(inner).toMatchObject({ dir: 'deep/inner', stem: 'Two' });
  });
});

describe('readProject', () => {
  it('takes only the chosen project, not everything that was dropped', async () => {
    // The converter finds the `.sspj` in what it is handed and re-bases the
    // rest on it, so a drop holding two projects would convert whichever it
    // saw last. Scoping here is what makes the choice the page's.
    const files: ProjectFile[] = [
      { file: new File(['one'], 'One.sspj'), path: 'drop/One/One.sspj' },
      { file: new File(['tex'], 'One.png'), path: 'drop/One/One.png' },
      { file: new File(['two'], 'Two.sspj'), path: 'drop/Two/Two.sspj' },
    ];
    const [one] = findProjects(files).filter((p) => p.stem === 'One');

    expect([...(await readProject(files, one)).keys()]).toEqual([
      'drop/One/One.sspj',
      'drop/One/One.png',
    ]);
  });

  it('leaves another project sharing the folder out of it', async () => {
    // Scoping by folder is not enough on its own: the converter picks the
    // `.sspj` out of what it is handed, so a second one in the same folder
    // would decide for the page. Found by dropping two at once in a browser.
    const files: ProjectFile[] = [
      { file: new File(['one'], 'One.sspj'), path: 'One.sspj' },
      { file: new File(['tex'], 'One.png'), path: 'One.png' },
      { file: new File(['two'], 'Two.sspj'), path: 'Two.sspj' },
    ];
    const [, two] = findProjects(files);

    expect([...(await readProject(files, two)).keys()]).toEqual(['One.png', 'Two.sspj']);
  });
});

describe.skipIf(!existsSync(WASM) || !existsSync(SAMPLE))('converting a dropped project', () => {
  it('produces a pack the runtime can read, with its textures inside it', async () => {
    await init(readFileSync(WASM));

    const dropped = asDropped(SAMPLE, 'Ringo');
    const [project] = findProjects(dropped);
    expect(project).toMatchObject({ dir: 'Ringo', stem: 'Ringo' });

    const result = convertProject(await readProject(dropped, project), { embedded: true });
    let packs: Map<string, Uint8Array>;
    try {
      packs = new Map(
        [...(result.output as Map<string, Uint8Array>)].filter(([name]) => name.endsWith('.ssab')),
      );
    } finally {
      result.free();
    }

    expect([...packs.keys()]).toContain('Ringo.ssab');
    const pack = packs.get('Ringo.ssab')!;
    expect(SSRuntimeManager.extractAnimationNames(pack).length).toBeGreaterThan(0);
    // `embedded` is what lets the page hand the player one buffer and no
    // texture map: without this the pack would ask for a sibling .png that
    // exists only in the reader's folder, not on any server.
    expect(SSRuntimeManager.extractEmbeddedTextures(pack).length).toBeGreaterThan(0);
  }, 60_000);
});
