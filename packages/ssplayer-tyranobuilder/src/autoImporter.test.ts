// Exercises the whole import pipeline outside the editor, against a real
// SpriteStudio project from the SDK submodule.
//
// What this can and cannot prove: the walk, the mtime marker, the wasm
// conversion and the file writes are all covered here. What it cannot cover is
// Electron's contextBridge itself — so instead it *simulates* both outcomes.
// `makeStudioApi('faithful')` hands back real Buffers, the way a bridge that
// passes binaries through would; `makeStudioApi('mangled')` returns the
// `{type:'Buffer',data:[…]}` husk a structured clone can degrade to and rejects
// non-string writes, which is the worst case the base64 fallback exists for.
// Both must produce byte-identical `.ssab` output.

import {
  appendFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import * as nodePath from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'vitest';

import { AutoImporter } from './autoImporter.js';
import { HostFs } from './hostFs.js';

const here = nodePath.dirname(fileURLToPath(import.meta.url));
const repoRoot = nodePath.resolve(here, '../../..');
const WASM = nodePath.join(repoRoot, 'packages/ssconverter-core/wasm/ssconverter_bg.wasm');
const SAMPLE = nodePath.join(repoRoot, 'SpriteStudio-SDK/tests/Ringo');

const haveFixtures = existsSync(WASM) && existsSync(SAMPLE);

type BridgeBehaviour = 'faithful' | 'mangled';

/** A stand-in for `window.studio_api`, backed by the real filesystem. */
function makeStudioApi(behaviour: BridgeBehaviour) {
  return {
    fs: {
      readFileSync(path: string, encoding?: string) {
        if (encoding) return readFileSync(path, encoding as BufferEncoding);
        const buf = readFileSync(path);
        if (behaviour === 'faithful') return buf;
        // A clone that lost its Uint8Array-ness.
        return { type: 'Buffer', data: Array.from(buf) };
      },
      writeFileSync(path: string, data: unknown, encoding?: string) {
        if (typeof data === 'string') {
          writeFileSync(path, data, (encoding ?? 'utf8') as BufferEncoding);
          return;
        }
        if (behaviour === 'mangled') {
          throw new TypeError('bridge refuses non-string payloads');
        }
        writeFileSync(path, data as Uint8Array);
      },
      appendFileSync(path: string, data: string) {
        appendFileSync(path, data, 'utf8');
      },
      existsSync,
      readdirSync,
      statSync,
      removeSync(path: string) {
        rmSync(path, { force: true, recursive: true });
      },
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

function withApi(behaviour: BridgeBehaviour): HostFs {
  (globalThis as { window?: unknown }).window = { studio_api: makeStudioApi(behaviour) };
  return HostFs.fromWindow();
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

function importerFor(root: string, fs: HostFs, log: string[]): AutoImporter {
  return new AutoImporter({
    fs,
    projectRoot: root,
    wasmPath: WASM,
    log: (line) => log.push(line),
  });
}

afterAll(() => {
  for (const dir of tempRoots) rmSync(dir, { recursive: true, force: true });
});

describe.skipIf(!haveFixtures)('AutoImporter', () => {
  it('converts a project, then skips it while the sources are unchanged', async () => {
    const root = makeProject();
    const fs = withApi('faithful');
    const log: string[] = [];
    const importer = importerFor(root, fs, log);

    expect(fs.probeBinaryBridge(nodePath.join(root, '.probe.bin')).mode).toBe('buffer');

    const first = await importer.runOnce();
    expect(first.failed).toEqual([]);
    expect(first.converted.map((c) => c.name)).toEqual(['Ringo']);

    const outDir = nodePath.join(root, 'data/others/ssdata/Ringo');
    const ssab = readdirSync(outDir).filter((f) => f.endsWith('.ssab'));
    expect(ssab.length).toBeGreaterThan(0);
    expect(statSync(nodePath.join(outDir, ssab[0])).size).toBeGreaterThan(0);
    // Import bookkeeping lives outside data/, which an export copies wholesale
    // into the shipped game.
    expect(existsSync(nodePath.join(outDir, '.ss_import_ok'))).toBe(false);
    expect(existsSync(nodePath.join(root, '.ss_import_state.json'))).toBe(true);
    expect(readdirSync(outDir).filter((f) => f.startsWith('.'))).toEqual([]);
    // Non-embedded output ships its textures alongside the pack.
    expect(first.converted[0].stats.copiedAssets).toBeGreaterThan(0);

    const second = await importer.runOnce();
    expect(second.converted).toEqual([]);
    expect(second.skipped).toEqual(['Ringo']);
  });

  it('reconverts once a source file is touched', async () => {
    const root = makeProject();
    const fs = withApi('faithful');
    const importer = importerFor(root, fs, []);

    await importer.runOnce();
    expect((await importer.runOnce()).skipped).toEqual(['Ringo']);

    const sspj = nodePath.join(root, 'SpriteStudio_Source/Ringo/Ringo.sspj');
    const future = new Date(Date.now() + 10_000);
    utimesSync(sspj, future, future);

    const third = await importer.runOnce();
    expect(third.converted.map((c) => c.name)).toEqual(['Ringo']);
  });

  it('produces identical output when binaries cannot cross the bridge', async () => {
    const faithfulRoot = makeProject();
    const faithful = importerFor(faithfulRoot, withApi('faithful'), []);
    await faithful.runOnce();

    const mangledRoot = makeProject();
    const mangledFs = withApi('mangled');
    const probe = mangledFs.probeBinaryBridge(nodePath.join(mangledRoot, '.probe.bin'));
    expect(probe.mode).toBe('base64');

    const mangled = importerFor(mangledRoot, mangledFs, []);
    const run = await mangled.runOnce();
    expect(run.failed).toEqual([]);
    expect(run.converted.map((c) => c.name)).toEqual(['Ringo']);

    const rel = 'data/others/ssdata/Ringo';
    const names = readdirSync(nodePath.join(faithfulRoot, rel)).filter((f) => f.endsWith('.ssab'));
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) {
      expect(readFileSync(nodePath.join(mangledRoot, rel, name))).toEqual(
        readFileSync(nodePath.join(faithfulRoot, rel, name)),
      );
    }
  });

  it('finds packs anywhere under data/, and reads their animation names', async () => {
    const root = makeProject();
    const fs = withApi('faithful');
    const importer = importerFor(root, fs, []);
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

  it('migrates the old in-output marker out of data/, without reconverting', async () => {
    const root = makeProject();
    const fs = withApi('faithful');
    const importer = importerFor(root, fs, []);
    await importer.runOnce();

    // Recreate a pre-move project: marker inside the pack folder, no state file.
    const outDir = nodePath.join(root, 'data/others/ssdata/Ringo');
    const state = JSON.parse(readFileSync(nodePath.join(root, '.ss_import_state.json'), 'utf8'));
    writeFileSync(
      nodePath.join(outDir, '.ss_import_ok'),
      JSON.stringify(state.packs.Ringo),
      'utf8',
    );
    rmSync(nodePath.join(root, '.ss_import_state.json'));

    const fresh = importerFor(root, fs, []);
    const run = await fresh.runOnce();

    // The old marker is trusted, so nothing is rebuilt...
    expect(run.skipped).toEqual(['Ringo']);
    // ...and it is gone from data/, carried over to the project root.
    expect(existsSync(nodePath.join(outDir, '.ss_import_ok'))).toBe(false);
    expect(existsSync(nodePath.join(root, '.ss_import_state.json'))).toBe(true);
  });

  it('reconverts when the output is deleted but the state survives', async () => {
    const root = makeProject();
    const importer = importerFor(root, withApi('faithful'), []);
    await importer.runOnce();

    rmSync(nodePath.join(root, 'data/others/ssdata/Ringo'), { recursive: true, force: true });

    const run = await importer.runOnce();
    expect(run.converted.map((c) => c.name)).toEqual(['Ringo']);
  });

  it('reports an empty run instead of failing when there is no .sspj', async () => {
    const root = mkdtempSync(nodePath.join(tmpdir(), 'ss-tb-poc-'));
    tempRoots.push(root);
    const importer = importerFor(root, withApi('faithful'), []);
    const run = await importer.runOnce();
    expect(run.empty).toBe(true);
    expect(run.failed).toEqual([]);
  });
});
