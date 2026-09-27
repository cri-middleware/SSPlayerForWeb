// The TyranoBuilder half of the importer, against a real SpriteStudio project
// from the SDK submodule: the pickers, `Reconvert`, and the state shapes older
// builds of this plugin wrote. The pass itself — freshness, the converter, the
// bridge fallback — is covered in `@spritestudio/ssconverter-importer`.

import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import * as nodePath from 'node:path';
import { fileURLToPath } from 'node:url';

import type { HostFs } from '@spritestudio/ssconverter-importer';
import { afterAll, describe, expect, it } from 'vitest';

import { BuilderImporter } from './builderImporter.js';
import { studioFs } from './studioFs.js';

const here = nodePath.dirname(fileURLToPath(import.meta.url));
const repoRoot = nodePath.resolve(here, '../../..');
const WASM = nodePath.join(repoRoot, 'packages/ssconverter-core/wasm/ssconverter_bg.wasm');
const SAMPLE = nodePath.join(repoRoot, 'SpriteStudio-SDK/tests/Ringo');

const haveFixtures = existsSync(WASM) && existsSync(SAMPLE);

/**
 * Bridge crossings, which is what a pass actually costs: every one of these is
 * a synchronous IPC hop on the editor's UI thread.
 */
interface Crossings {
  stat: number;
  readdir: number;
}

/** A stand-in for `window.studio_api`, backed by the real filesystem. */
function makeStudioApi(count: Crossings) {
  return {
    fs: {
      readFileSync: (path: string, encoding?: string) =>
        encoding ? readFileSync(path, encoding as BufferEncoding) : readFileSync(path),
      writeFileSync(path: string, data: unknown, encoding?: string) {
        if (typeof data === 'string') {
          writeFileSync(path, data, (encoding ?? 'utf8') as BufferEncoding);
          return;
        }
        writeFileSync(path, data as Uint8Array);
      },
      appendFileSync: (path: string, data: string) => writeFileSync(path, data, { flag: 'a' }),
      existsSync,
      readdirSync(path: string) {
        count.readdir++;
        return readdirSync(path);
      },
      statSync(path: string) {
        count.stat++;
        return statSync(path);
      },
      removeSync: (path: string) => rmSync(path, { force: true, recursive: true }),
      copySync(src: string, dest: string) {
        mkdirSync(nodePath.dirname(dest), { recursive: true });
        cpSync(src, dest, { recursive: true });
      },
    },
    fs_default: {},
    path: nodePath,
    mkdirp: { sync: (dir: string) => void mkdirSync(dir, { recursive: true }) },
  };
}

function withApi(count: Crossings = { stat: 0, readdir: 0 }): HostFs {
  (globalThis as { window?: unknown }).window = { studio_api: makeStudioApi(count) };
  return studioFs();
}

const tempRoots: string[] = [];

/** A minimal TyranoBuilder project holding a copy of the sample. */
function makeProject(): string {
  const root = mkdtempSync(nodePath.join(tmpdir(), 'ss-tb-poc-'));
  tempRoots.push(root);
  mkdirSync(nodePath.join(root, 'data/scenario'), { recursive: true });
  cpSync(SAMPLE, nodePath.join(root, 'SpriteStudio_Source/Ringo'), { recursive: true });
  return root;
}

function importerFor(root: string, fs: HostFs): BuilderImporter {
  return new BuilderImporter({ fs, projectRoot: root, wasmPath: WASM, log: () => {} });
}

/** The import state's key for a pack: its output folder, below the project. */
const packKey = (stem: string): string => `data/others/ssdata/${stem}`;

afterAll(() => {
  for (const dir of tempRoots) rmSync(dir, { recursive: true, force: true });
});

describe.skipIf(!haveFixtures)('BuilderImporter', () => {
  it('finds packs anywhere under data/, and reads their animation names', async () => {
    const root = makeProject();
    const fs = withApi();
    const importer = importerFor(root, fs);
    await importer.runOnce();

    // A pack an author placed by hand, outside the importer's output folder.
    const hand = nodePath.join(root, 'data/image/scene1');
    mkdirSync(hand, { recursive: true });
    cpSync(
      nodePath.join(root, 'data/others/ssdata/Ringo/Ringo.ssab'),
      nodePath.join(hand, 'Copy.ssab'),
    );

    const packs = importer.listPacks().map((p) => p.val);
    expect(packs).toContain('others/ssdata/Ringo/Ringo.ssab');
    expect(packs).toContain('image/scene1/Copy.ssab');
    // Imported packs sort first; hand-placed ones follow.
    expect(packs[0].startsWith('others/ssdata/')).toBe(true);

    // The .ssab is what the runtime loads, so it is what the picker reads.
    const names = importer.listAnimations('others/ssdata/Ringo/Ringo.ssab');
    expect(names.length).toBeGreaterThan(0);
    expect(names).toEqual(importer.listAnimations('image/scene1/Copy.ssab'));
    expect(names.every((n) => typeof n === 'string' && n.length > 0)).toBe(true);

    // Paths this process cannot read must come back empty, not throw.
    expect(importer.listAnimations('https://example.com/Boss.ssab')).toEqual([]);
    expect(importer.listAnimations('')).toEqual([]);
    expect(importer.listAnimations('others/ssdata/Ringo/Ringo.png')).toEqual([]);
  });

  it('walks data/ once per task, however many pickers ask', async () => {
    const root = makeProject();
    const count: Crossings = { stat: 0, readdir: 0 };
    const importer = importerFor(root, withApi(count));
    await importer.runOnce();

    const hand = nodePath.join(root, 'data/image/scene1');
    mkdirSync(hand, { recursive: true });

    count.readdir = 0;
    const first = importer.listPacks();
    const walked = count.readdir;
    expect(walked).toBeGreaterThan(0);
    expect(first.length).toBeGreaterThan(0);

    // What one inspector render looks like: the host renders a component's
    // params in a single synchronous loop, and more than one of them asks.
    expect(importer.listPacks()).toBe(first);
    expect(importer.listPacks()).toBe(first);
    expect(count.readdir).toBe(walked);

    // A pack that appears while the builder is open — a conversion, or a file
    // an author copied in. Nothing tells the importer about it, so the scan has
    // to be dropped rather than invalidated.
    cpSync(
      nodePath.join(root, 'data/others/ssdata/Ringo/Ringo.ssab'),
      nodePath.join(hand, 'Copy.ssab'),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(count.readdir).toBe(walked);
    expect(importer.listPacks().map((p) => p.val)).toContain('image/scene1/Copy.ssab');
    expect(count.readdir).toBeGreaterThan(walked);
  });

  it('migrates the old in-output marker out of data/, without reconverting', async () => {
    const root = makeProject();
    const fs = withApi();
    const importer = importerFor(root, fs);
    await importer.runOnce();

    // Recreate a pre-move project: marker inside the pack folder, no state file.
    const outDir = nodePath.join(root, 'data/others/ssdata/Ringo');
    const state = JSON.parse(readFileSync(nodePath.join(root, '.ss_import_state.json'), 'utf8'));
    writeFileSync(
      nodePath.join(outDir, '.ss_import_ok'),
      JSON.stringify(state.packs[packKey('Ringo')]),
      'utf8',
    );
    rmSync(nodePath.join(root, '.ss_import_state.json'));

    const fresh = importerFor(root, fs);
    const run = await fresh.runOnce();

    // The old marker is trusted, so nothing is rebuilt...
    expect(run.skipped).toEqual(['Ringo']);
    // ...and it is gone from data/, carried over to the project root.
    expect(existsSync(nodePath.join(outDir, '.ss_import_ok'))).toBe(false);
    expect(existsSync(nodePath.join(root, '.ss_import_state.json'))).toBe(true);
  });

  it('rebuilds the one pack a Reconvert names, fresh marker or not', async () => {
    const root = makeProject();
    const importer = importerFor(root, withApi());
    await importer.runOnce();
    expect((await importer.runOnce()).skipped).toEqual(['Ringo']);

    // Nothing on disk changed: the point of the button is to convert anyway.
    const run = await importer.reconvertPack('others/ssdata/Ringo/Ringo.ssab');
    expect(run?.failed).toEqual([]);
    expect(run?.converted.map((c) => c.name)).toEqual(['Ringo']);
    expect(run?.skipped).toEqual([]);

    // And the pass after it is an ordinary one again — the forced run
    // re-records what it covered rather than leaving the state forgotten.
    expect((await importer.runOnce()).skipped).toEqual(['Ringo']);
  });

  it('declines to Reconvert a pack it did not produce', async () => {
    const root = makeProject();
    const fs = withApi();
    const importer = importerFor(root, fs);
    await importer.runOnce();

    // A pack the author put in `data/` by hand: no `.sspj` to go back to, and
    // silently converting something else would be worse than saying so.
    const hand = nodePath.join(root, 'data/image/scene1');
    mkdirSync(hand, { recursive: true });
    cpSync(
      nodePath.join(root, 'data/others/ssdata/Ringo/Ringo.ssab'),
      nodePath.join(hand, 'Copy.ssab'),
    );

    expect(await importer.reconvertPack('image/scene1/Copy.ssab')).toBeNull();
    expect(await importer.reconvertPack('https://example.com/Boss.ssab')).toBeNull();
    expect(await importer.reconvertPack('')).toBeNull();
  });

  it('reports an empty run when the Reconvert target has lost its source', async () => {
    const root = makeProject();
    const importer = importerFor(root, withApi());
    await importer.runOnce();

    rmSync(nodePath.join(root, 'SpriteStudio_Source/Ringo'), { recursive: true, force: true });

    const run = await importer.reconvertPack('others/ssdata/Ringo/Ringo.ssab');
    expect(run?.empty).toBe(true);
    expect(run?.failed).toEqual([]);
  });

  it('serialises passes that overlap', async () => {
    const root = makeProject();
    const importer = importerFor(root, withApi());
    await importer.runOnce();

    // Project open and a Reconvert click are independent callers wanting
    // different work done; they must not convert into the same output folder
    // at the same time, and neither may be handed the other's answer.
    const [plain, forced] = await Promise.all([
      importer.runOnce(),
      importer.reconvertPack('others/ssdata/Ringo/Ringo.ssab'),
    ]);
    expect(plain.skipped).toEqual(['Ringo']);
    expect(forced?.converted.map((c) => c.name)).toEqual(['Ringo']);
  });

  it('removes output it no longer produces, and nothing else', async () => {
    const root = makeProject();
    const importer = importerFor(root, withApi());
    await importer.runOnce();

    const outDir = nodePath.join(root, 'data/others/ssdata/Ringo');
    expect(readdirSync(outDir)).toContain('Ringo_tyu.ssab');
    // A file the author put beside the pack. Not ours, not a candidate.
    writeFileSync(nodePath.join(outDir, 'notes.txt'), 'mine', 'utf8');

    // Drop one animation pack from the project, the way removing it in
    // SpriteStudio would.
    const src = nodePath.join(root, 'SpriteStudio_Source/Ringo');
    const sspj = nodePath.join(src, 'Ringo.sspj');
    writeFileSync(
      sspj,
      readFileSync(sspj, 'utf8').replace(/\s*<value>Ringo_tyu\.ssae<\/value>/, ''),
      'utf8',
    );
    rmSync(nodePath.join(src, 'Ringo_tyu.ssae'));

    await importer.reconvertPack('others/ssdata/Ringo/Ringo.ssab');

    const left = readdirSync(outDir);
    expect(left).not.toContain('Ringo_tyu.ssab');
    expect(left).toContain('Ringo.ssab');
    expect(left).toContain('notes.txt');
    // And the picker stops offering a pack that no longer exists.
    expect(importer.listPacks().map((p) => p.val)).not.toContain(
      'others/ssdata/Ringo/Ringo_tyu.ssab',
    );
  });

  it('rebuilds a pack copied out of the output folder, where it lies', async () => {
    const root = makeProject();
    const importer = importerFor(root, withApi());
    await importer.runOnce();

    // An author is free to keep a pack anywhere under data/ — the picker lists
    // them all — so Reconvert has to write where the .ssab is, not where this
    // importer would have put it. Same rule as SSPlayerForUnity's
    // `ReconvertInto` and SSPlayerForGodot's `queue_reconvert`.
    const copy = nodePath.join(root, 'data/image/hero');
    cpSync(nodePath.join(root, 'data/others/ssdata/Ringo'), copy, { recursive: true });
    rmSync(nodePath.join(copy, 'Ringo.ssab'));

    const run = await importer.reconvertPack('image/hero/Ringo.ssab');
    expect(run?.converted.map((c) => c.name)).toEqual(['Ringo']);
    expect(existsSync(nodePath.join(copy, 'Ringo.ssab'))).toBe(true);
  });

  it('carries over a record written when the key was the .sspj stem', async () => {
    const root = makeProject();
    const fs = withApi();
    await importerFor(root, fs).runOnce();

    const statePath = nodePath.join(root, '.ss_import_state.json');
    const state = JSON.parse(readFileSync(statePath, 'utf8'));
    // What the file looked like before the key described a folder.
    writeFileSync(
      statePath,
      JSON.stringify({ packs: { Ringo: state.packs[packKey('Ringo')] } }),
      'utf8',
    );

    const fresh = importerFor(root, fs);
    expect(fresh.hasImported()).toBe(true);
    // Re-keyed, not re-converted: the record still describes what is on disk.
    expect((await fresh.runOnce()).skipped).toEqual(['Ringo']);
    expect(Object.keys(JSON.parse(readFileSync(statePath, 'utf8')).packs)).toEqual([
      packKey('Ringo'),
    ]);
  });

});
