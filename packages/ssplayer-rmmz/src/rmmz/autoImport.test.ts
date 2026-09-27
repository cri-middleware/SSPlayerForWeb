// @vitest-environment node
//
// The test-play importer's MZ-free half, against a real SpriteStudio project
// from the SDK submodule: Node's `fs` in the importer's shape, the folders it
// is pointed at, and the line MZ's error screen shows. The boot gate and the
// screen itself run only inside MZ and are checked there.

import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import * as nodePath from 'node:path';
import { fileURLToPath } from 'node:url';

import { HostFs } from '@spritestudio/ssconverter-importer';
import { afterAll, describe, expect, it } from 'vitest';

import {
  OUT_DIR,
  SOURCE_DIR,
  STATE_FILE,
  WASM_FILE,
  createImporter,
  describeProblems,
  nodeBackend,
} from './autoImport.js';

const here = nodePath.dirname(fileURLToPath(import.meta.url));
const repoRoot = nodePath.resolve(here, '../../../..');
const WASM = nodePath.join(repoRoot, 'packages/ssconverter-core/wasm/ssconverter_bg.wasm');
const SAMPLE = nodePath.join(repoRoot, 'SpriteStudio-SDK/tests/Ringo');

const haveFixtures = existsSync(WASM) && existsSync(SAMPLE);

const tempRoots: string[] = [];

/** An MZ project folder with the converter installed and the sample dropped in. */
function makeProject(): string {
  const root = mkdtempSync(nodePath.join(tmpdir(), 'ss-rmmz-import-'));
  tempRoots.push(root);
  mkdirSync(nodePath.join(root, 'js/plugins'), { recursive: true });
  cpSync(WASM, nodePath.join(root, 'js/plugins', WASM_FILE));
  cpSync(SAMPLE, nodePath.join(root, SOURCE_DIR, 'Ringo'), { recursive: true });
  return root;
}

const fs = new HostFs(nodeBackend(createRequire(import.meta.url)));

afterAll(() => {
  for (const dir of tempRoots) rmSync(dir, { recursive: true, force: true });
});

describe.skipIf(!haveFixtures)('test-play import', () => {
  it('converts into spritestudio/, keeps its record beside the sources, then skips', async () => {
    const root = makeProject();
    const importer = createImporter(fs, root, () => {});

    const first = await importer.runOnce();
    expect(first.failed).toEqual([]);
    expect(first.converted.map((c) => c.name)).toEqual(['Ringo']);
    // The path a `showSS` command is given.
    expect(existsSync(nodePath.join(root, OUT_DIR, 'Ringo/Ringo.ssab'))).toBe(true);
    expect(existsSync(nodePath.join(root, OUT_DIR, 'Ringo/Ringo.png'))).toBe(true);
    // One folder to leave out of a deployment covers the record too.
    expect(existsSync(nodePath.join(root, STATE_FILE))).toBe(true);
    expect(readdirSync(root).filter((f) => f.startsWith('.'))).toEqual([]);

    const again = createImporter(fs, root, () => {});
    expect((await again.runOnce()).skipped).toEqual(['Ringo']);
  });

  it('removes a pack the project no longer produces', async () => {
    const root = makeProject();
    await createImporter(fs, root, () => {}).runOnce();
    const outDir = nodePath.join(root, OUT_DIR, 'Ringo');
    expect(readdirSync(outDir)).toContain('Ringo_tyu.ssab');

    // Remove one animation pack the way SpriteStudio would, and date the edit
    // after the last import.
    const src = nodePath.join(root, SOURCE_DIR, 'Ringo');
    const sspj = nodePath.join(src, 'Ringo.sspj');
    writeFileSync(
      sspj,
      readFileSync(sspj, 'utf8').replace(/\s*<value>Ringo_tyu\.ssae<\/value>/, ''),
      'utf8',
    );
    rmSync(nodePath.join(src, 'Ringo_tyu.ssae'));

    const run = await createImporter(fs, root, () => {}).runOnce();
    expect(run.converted.map((c) => c.name)).toEqual(['Ringo']);
    expect(readdirSync(outDir)).not.toContain('Ringo_tyu.ssab');
    expect(readdirSync(outDir)).toContain('Ringo.ssab');
  });
});

describe('describeProblems', () => {
  const clean = { converted: [], skipped: [], failed: [], dropped: [], empty: false };

  it('is empty when there is nothing for the author to fix', () => {
    expect(describeProblems({ ...clean, skipped: ['Ringo'] })).toBe('');
  });

  it('names the project and the reason, and counts the rest', () => {
    expect(describeProblems({ ...clean, failed: [{ name: 'Ringo', error: 'bad cell' }] })).toBe(
      'Ringo: bad cell',
    );
    const two = describeProblems({
      ...clean,
      failed: [{ name: 'Ringo', error: 'bad cell' }],
      dropped: [{ name: 'hero', source: 'enemy/hero.sspj', kept: 'chara/hero.sspj' }],
    });
    expect(two).toBe('Ringo: bad cell (+1 more; see the console, F8)');
  });

  it('says which two projects want one folder', () => {
    expect(
      describeProblems({
        ...clean,
        dropped: [{ name: 'hero', source: 'enemy/hero.sspj', kept: 'chara/hero.sspj' }],
      }),
    ).toBe(
      'enemy/hero.sspj was not converted: chara/hero.sspj already writes to ' +
        'spritestudio/hero. Rename one of them.',
    );
  });
});
