// Exercises the whole import pipeline outside any host, against a real
// SpriteStudio project from the SDK submodule.
//
// What this can and cannot prove: the walk, the mtime marker, the wasm
// conversion and the file writes are all covered here. What it cannot cover is
// a host's bridge itself (TyranoBuilder's contextBridge) — so instead it
// *simulates* both outcomes. `makeBackend('faithful')` hands back real Buffers,
// the way a bridge that passes binaries through would; `makeBackend('mangled')`
// returns the `{type:'Buffer',data:[…]}` husk a structured clone can degrade to
// and rejects non-string writes, which is the worst case the base64 fallback
// exists for. Both must produce byte-identical `.ssab` output.

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
import { convertProjectAt, type Converter } from './converter.js';
import { HostFs } from './hostFs.js';
import type { HostBackend } from './hostTypes.js';

const here = nodePath.dirname(fileURLToPath(import.meta.url));
const repoRoot = nodePath.resolve(here, '../../..');
const WASM = nodePath.join(repoRoot, 'packages/ssconverter-core/wasm/ssconverter_bg.wasm');
const SAMPLE = nodePath.join(repoRoot, 'SpriteStudio-SDK/tests/Ringo');

const haveFixtures = existsSync(WASM) && existsSync(SAMPLE);

type BridgeBehaviour = 'faithful' | 'mangled';

/**
 * Bridge crossings, which is what a pass actually costs behind a bridge: every
 * one of these is a synchronous IPC hop on the host's UI thread.
 */
interface Crossings {
  stat: number;
  readdir: number;
}

/** A host's filesystem, backed by the real one. */
function makeBackend(
  behaviour: BridgeBehaviour,
  count: Crossings = { stat: 0, readdir: 0 },
): HostBackend {
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
      readdirSync(path: string) {
        count.readdir++;
        return readdirSync(path);
      },
      statSync(path: string) {
        count.stat++;
        return statSync(path);
      },
      removeSync(path: string) {
        rmSync(path, { force: true, recursive: true });
      },
      copySync(src: string, dest: string) {
        mkdirSync(nodePath.dirname(dest), { recursive: true });
        cpSync(src, dest, { recursive: true });
      },
    },
    path: nodePath,
    mkdirp: { sync: (dir: string) => void mkdirSync(dir, { recursive: true }) },
  };
}

function fsFor(behaviour: BridgeBehaviour, count?: Crossings): HostFs {
  return new HostFs(makeBackend(behaviour, count));
}

const tempRoots: string[] = [];

/** A project with no SpriteStudio sources in it yet. */
function makeEmptyProject(): string {
  const root = mkdtempSync(nodePath.join(tmpdir(), 'ss-importer-'));
  tempRoots.push(root);
  return root;
}

/** A project holding a copy of the sample. */
function makeProject(): string {
  const root = makeEmptyProject();
  cpSync(SAMPLE, nodePath.join(root, 'SpriteStudio_Source/Ringo'), { recursive: true });
  return root;
}

/** Where these tests have packs written, relative to the project root. */
const OUT = 'assets/ss';

function importerFor(
  root: string,
  fs: HostFs,
  log: string[],
  extra: { wasmPath?: string; workerSource?: string; stateFile?: string } = {},
): AutoImporter {
  return new AutoImporter({
    fs,
    projectRoot: root,
    outDirName: OUT,
    wasmPath: extra.wasmPath ?? WASM,
    workerSource: extra.workerSource,
    stateFile: extra.stateFile,
    log: (line) => log.push(line),
  });
}

/** The import state's key for a pack: its output folder, below the project. */
const packKey = (stem: string): string => `${OUT}/${stem}`;

/** Files plus directories under `dir` — one `stat` each is what a walk costs. */
function countEntries(dir: string): number {
  let total = 0;
  for (const name of readdirSync(dir)) {
    if (name.startsWith('.') || name === 'Thumbs.db') continue;
    total++;
    const full = nodePath.join(dir, name);
    if (statSync(full).isDirectory()) total += countEntries(full);
  }
  return total;
}

afterAll(() => {
  for (const dir of tempRoots) rmSync(dir, { recursive: true, force: true });
});

describe('convertProjectAt', () => {
  it('hands the converter the one .sspj it was asked for, and no other', async () => {
    // The converter takes no name: with two `.sspj` in the map it converted
    // whichever came last, so a backup beside the project replaced it without
    // a word, and a project in a subfolder failed the whole conversion.
    const root = makeEmptyProject();
    const dir = nodePath.join(root, 'hero');
    mkdirSync(nodePath.join(dir, 'old'), { recursive: true });
    for (const name of ['hero.sspj', 'hero.ssae', 'hero_old.sspj', 'old/hero.sspj']) {
      writeFileSync(nodePath.join(dir, name), name);
    }

    let handed: string[] = [];
    const converter: Converter = {
      version: 'test',
      schema: { ssab: 0, ssqb: 0 },
      mode: 'inline',
      detail: '',
      convert: async (files) => {
        handed = [...files.keys()].sort();
        return { output: new Map(), assets: new Map() };
      },
      dispose: () => {},
    };
    await convertProjectAt(fsFor('faithful'), converter, nodePath.join(dir, 'hero.sspj'), nodePath.join(root, 'out'), () => 0);

    expect(handed).toEqual(['hero.ssae', 'hero.sspj']);
  });
});

describe.skipIf(!haveFixtures)('AutoImporter', () => {
  it('converts a project, then skips it while the sources are unchanged', async () => {
    const root = makeProject();
    const fs = fsFor('faithful');
    const log: string[] = [];
    const importer = importerFor(root, fs, log);

    expect(fs.probeBinaryBridge(nodePath.join(root, '.probe.bin')).mode).toBe('buffer');

    const first = await importer.runOnce();
    expect(first.failed).toEqual([]);
    expect(first.converted.map((c) => c.name)).toEqual(['Ringo']);

    const outDir = nodePath.join(root, OUT, 'Ringo');
    const ssab = readdirSync(outDir).filter((f) => f.endsWith('.ssab'));
    expect(ssab.length).toBeGreaterThan(0);
    expect(statSync(nodePath.join(outDir, ssab[0])).size).toBeGreaterThan(0);
    // Import bookkeeping lives outside the output folder, which a host's export
    // may copy wholesale into the shipped game.
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
    const fs = fsFor('faithful');
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
    const faithful = importerFor(faithfulRoot, fsFor('faithful'), []);
    await faithful.runOnce();

    const mangledRoot = makeProject();
    const mangledFs = fsFor('mangled');
    const probe = mangledFs.probeBinaryBridge(nodePath.join(mangledRoot, '.probe.bin'));
    expect(probe.mode).toBe('base64');

    const mangled = importerFor(mangledRoot, mangledFs, []);
    const run = await mangled.runOnce();
    expect(run.failed).toEqual([]);
    expect(run.converted.map((c) => c.name)).toEqual(['Ringo']);

    const rel = `${OUT}/Ringo`;
    const names = readdirSync(nodePath.join(faithfulRoot, rel)).filter((f) => f.endsWith('.ssab'));
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) {
      expect(readFileSync(nodePath.join(mangledRoot, rel, name))).toEqual(
        readFileSync(nodePath.join(faithfulRoot, rel, name)),
      );
    }
  });

  it('reconverts an animation edit that leaves the .sspj untouched', async () => {
    const root = makeProject();
    const importer = importerFor(root, fsFor('faithful'), []);
    await importer.runOnce();
    expect((await importer.runOnce()).skipped).toEqual(['Ringo']);

    // What a SpriteStudio save actually looks like: only the file that changed
    // is written, so the manifest keeps its old date. Keying off the `.sspj`
    // would miss this, which is why the whole folder is walked.
    const ssae = nodePath.join(root, 'SpriteStudio_Source/Ringo/Ringo.ssae');
    const future = new Date(Date.now() + 10_000);
    utimesSync(ssae, future, future);
    const sspj = nodePath.join(root, 'SpriteStudio_Source/Ringo/Ringo.sspj');
    const sspjBefore = statSync(sspj).mtimeMs;

    expect((await importer.runOnce()).converted.map((c) => c.name)).toEqual(['Ringo']);
    expect(statSync(sspj).mtimeMs).toBe(sspjBefore);
  });

  it('ignores dot entries when dating the sources', async () => {
    const root = makeProject();
    const importer = importerFor(root, fsFor('faithful'), []);
    await importer.runOnce();

    // A `.git` checkout beside the sources is newer than everything, and its
    // contents are not themselves dot-prefixed. Counting it would reconvert on
    // every project open, forever.
    const git = nodePath.join(root, 'SpriteStudio_Source/.git');
    mkdirSync(git, { recursive: true });
    const future = new Date(Date.now() + 86_400_000);
    writeFileSync(nodePath.join(git, 'HEAD'), 'ref: refs/heads/main\n', 'utf8');
    utimesSync(nodePath.join(git, 'HEAD'), future, future);

    expect((await importer.runOnce()).skipped).toEqual(['Ringo']);
  });

  it('rebuilds a pack whose record came from a different converter build', async () => {
    const root = makeProject();
    const fs = fsFor('faithful');
    await importerFor(root, fs, []).runOnce();

    // What a plugin update looks like from the state file's side. Nothing else
    // rebuilds a pack whose sources have not moved.
    const statePath = nodePath.join(root, '.ss_import_state.json');
    const state = JSON.parse(readFileSync(statePath, 'utf8'));
    state.packs[packKey('Ringo')].converter = 'some-older-build';
    writeFileSync(statePath, JSON.stringify(state), 'utf8');

    const after = importerFor(root, fs, []);
    expect((await after.runOnce()).converted.map((c) => c.name)).toEqual(['Ringo']);
    expect((await after.runOnce()).skipped).toEqual(['Ringo']);
  });

  it('reconverts when the output is deleted but the state survives', async () => {
    const root = makeProject();
    const importer = importerFor(root, fsFor('faithful'), []);
    await importer.runOnce();

    rmSync(nodePath.join(root, OUT, 'Ringo'), { recursive: true, force: true });

    const run = await importer.runOnce();
    expect(run.converted.map((c) => c.name)).toEqual(['Ringo']);
  });

  it('reports an empty run instead of failing when there is no .sspj', async () => {
    const root = makeEmptyProject();
    const importer = importerFor(root, fsFor('faithful'), []);
    const run = await importer.runOnce();
    expect(run.empty).toBe(true);
    expect(run.failed).toEqual([]);
  });

  it('costs one stat per source entry on a pass that changes nothing', async () => {
    const root = makeProject();
    const count: Crossings = { stat: 0, readdir: 0 };
    const importer = importerFor(root, fsFor('faithful', count), []);
    await importer.runOnce();

    const sourceEntries = countEntries(nodePath.join(root, 'SpriteStudio_Source'));
    count.stat = 0;
    count.readdir = 0;
    expect((await importer.runOnce()).skipped).toEqual(['Ringo']);

    // Behind a bridge every one of these is a synchronous hop on the host's UI
    // thread, so the count is the point. One walk of the sources,
    // and for the output nothing beyond a shallow "is there anything here":
    // finding the projects and dating them used to be separate traversals,
    // statting each source file three times over, and the output tree was
    // walked in full — copied textures and all — on top of that.
    expect(count.stat).toBe(sourceEntries);
    expect(count.readdir).toBeLessThan(sourceEntries);
  });

  it('still converts when the Worker refuses to start', async () => {
    // The Worker is created from a Blob URL because a file:// document cannot
    // load a worker script from another file:// URL, and no vendor documents
    // what a given host build allows. Whatever the reason it fails, the
    // fallback is the behaviour the importer shipped with, not a broken one.
    const root = makeProject();
    const fs = fsFor('faithful');

    // Its own wasm path, because the converter is cached per wasm for the
    // session and the other tests in this file have already started one.
    const wasmPath = nodePath.join(root, 'ssconverter_bg.wasm');
    cpSync(WASM, wasmPath);

    const original = (globalThis as { Worker?: unknown }).Worker;
    (globalThis as { Worker?: unknown }).Worker = class {
      constructor() {
        throw new Error('refused');
      }
    };

    try {
      const importer = importerFor(root, fs, [], { wasmPath, workerSource: '/* a worker */' });
      const converter = await importer.converter();
      expect(converter.mode).toBe('inline');
      // The log line an author would read to find out why the host froze.
      expect(converter.detail).toContain('refused');

      const run = await importer.runOnce();
      expect(run.failed).toEqual([]);
      expect(run.converted.map((c) => c.name)).toEqual(['Ringo']);
      expect(
        readdirSync(nodePath.join(root, OUT, 'Ringo')).some((f) =>
          f.endsWith('.ssab'),
        ),
      ).toBe(true);
    } finally {
      if (original === undefined) delete (globalThis as { Worker?: unknown }).Worker;
      else (globalThis as { Worker?: unknown }).Worker = original;
    }
  });

  it('gives one output folder to one project, and names the one it dropped', async () => {
    // Two projects of the same name resolve to the same `outRoot/<stem>`.
    // Converting both wrote that folder twice — the second silently replaced
    // the first — and the record they shared then said both were current, so
    // the loser was never rebuilt either.
    const root = makeEmptyProject();
    cpSync(SAMPLE, nodePath.join(root, 'SpriteStudio_Source/chara/Ringo'), { recursive: true });
    cpSync(SAMPLE, nodePath.join(root, 'SpriteStudio_Source/enemy/Ringo'), { recursive: true });

    const log: string[] = [];
    const importer = importerFor(root, fsFor('faithful'), log);
    const run = await importer.runOnce();

    expect(run.converted.map((c) => c.name)).toEqual(['Ringo']);
    expect(run.dropped).toHaveLength(1);
    // Both sides of the clash, because the fix is to rename one of them.
    const [drop] = run.dropped;
    expect([drop.source, drop.kept].sort()).toEqual([
      'chara/Ringo/Ringo.sspj',
      'enemy/Ringo/Ringo.sspj',
    ]);
    expect(log.join('\n')).toContain('not converted');

    // Still a clash on the next pass, and still said so: the condition is on
    // disk, not something the first run resolved.
    expect((await importer.runOnce()).dropped).toHaveLength(1);
  });

  it('knows whether this project has ever imported anything', async () => {
    // What tells a first-time project ("here is where the sources go") from
    // one whose author has since emptied the source folder.
    const root = makeProject();
    const importer = importerFor(root, fsFor('faithful'), []);
    expect(importer.hasImported()).toBe(false);
    await importer.runOnce();
    expect(importer.hasImported()).toBe(true);
  });
  it('keeps its state where the host asks', async () => {
    // A host whose export copies the project root keeps the record beside the
    // sources instead, so one exclusion covers both.
    const root = makeProject();
    const stateFile = 'SpriteStudio_Source/.ss_import_state.json';
    await importerFor(root, fsFor('faithful'), [], { stateFile }).runOnce();

    expect(existsSync(nodePath.join(root, stateFile))).toBe(true);
    expect(existsSync(nodePath.join(root, '.ss_import_state.json'))).toBe(false);
    const again = importerFor(root, fsFor('faithful'), [], { stateFile });
    expect((await again.runOnce()).skipped).toEqual(['Ringo']);
  });
});
