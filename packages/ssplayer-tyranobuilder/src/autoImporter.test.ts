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

/**
 * Bridge crossings, which is what a pass actually costs: every one of these is
 * a synchronous IPC hop on the editor's UI thread.
 */
interface Crossings {
  stat: number;
  readdir: number;
}

/** A stand-in for `window.studio_api`, backed by the real filesystem. */
function makeStudioApi(behaviour: BridgeBehaviour, count: Crossings = { stat: 0, readdir: 0 }) {
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
    fs_default: {},
    path: nodePath,
    mkdirp: { sync: (dir: string) => void mkdirSync(dir, { recursive: true }) },
  };
}

function withApi(behaviour: BridgeBehaviour, count?: Crossings): HostFs {
  (globalThis as { window?: unknown }).window = { studio_api: makeStudioApi(behaviour, count) };
  return HostFs.fromWindow();
}

const tempRoots: string[] = [];

/** A TyranoBuilder project with no SpriteStudio sources in it yet. */
function makeEmptyProject(): string {
  const root = mkdtempSync(nodePath.join(tmpdir(), 'ss-tb-poc-'));
  tempRoots.push(root);
  mkdirSync(nodePath.join(root, 'data/scenario'), { recursive: true });
  return root;
}

/** A minimal TyranoBuilder project holding a copy of the sample. */
function makeProject(): string {
  const root = makeEmptyProject();
  cpSync(SAMPLE, nodePath.join(root, 'SpriteStudio_Source/Ringo'), { recursive: true });
  return root;
}

function importerFor(
  root: string,
  fs: HostFs,
  log: string[],
  extra: { wasmPath?: string; workerSource?: string } = {},
): AutoImporter {
  return new AutoImporter({
    fs,
    projectRoot: root,
    wasmPath: extra.wasmPath ?? WASM,
    workerSource: extra.workerSource,
    log: (line) => log.push(line),
  });
}

/** The import state's key for a pack: its output folder, below the project. */
const packKey = (stem: string): string => `data/others/ssdata/${stem}`;

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

  it('walks data/ once per task, however many pickers ask', async () => {
    const root = makeProject();
    const count: Crossings = { stat: 0, readdir: 0 };
    const importer = importerFor(root, withApi('faithful', count), []);
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
    const fs = withApi('faithful');
    const importer = importerFor(root, fs, []);
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

    const fresh = importerFor(root, fs, []);
    const run = await fresh.runOnce();

    // The old marker is trusted, so nothing is rebuilt...
    expect(run.skipped).toEqual(['Ringo']);
    // ...and it is gone from data/, carried over to the project root.
    expect(existsSync(nodePath.join(outDir, '.ss_import_ok'))).toBe(false);
    expect(existsSync(nodePath.join(root, '.ss_import_state.json'))).toBe(true);
  });

  it('reconverts an animation edit that leaves the .sspj untouched', async () => {
    const root = makeProject();
    const importer = importerFor(root, withApi('faithful'), []);
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
    const importer = importerFor(root, withApi('faithful'), []);
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

  it('rebuilds the one pack a Reconvert names, fresh marker or not', async () => {
    const root = makeProject();
    const importer = importerFor(root, withApi('faithful'), []);
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
    const fs = withApi('faithful');
    const importer = importerFor(root, fs, []);
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
    const importer = importerFor(root, withApi('faithful'), []);
    await importer.runOnce();

    rmSync(nodePath.join(root, 'SpriteStudio_Source/Ringo'), { recursive: true, force: true });

    const run = await importer.reconvertPack('others/ssdata/Ringo/Ringo.ssab');
    expect(run?.empty).toBe(true);
    expect(run?.failed).toEqual([]);
  });

  it('rebuilds a pack whose record came from a different converter build', async () => {
    const root = makeProject();
    const fs = withApi('faithful');
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

  it('costs one stat per source entry on a pass that changes nothing', async () => {
    const root = makeProject();
    const count: Crossings = { stat: 0, readdir: 0 };
    const importer = importerFor(root, withApi('faithful', count), []);
    await importer.runOnce();

    const sourceEntries = countEntries(nodePath.join(root, 'SpriteStudio_Source'));
    count.stat = 0;
    count.readdir = 0;
    expect((await importer.runOnce()).skipped).toEqual(['Ringo']);

    // Every one of these is a synchronous hop across the contextBridge on the
    // editor's UI thread, so the count is the point. One walk of the sources,
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
    // what a given builder build allows. Whatever the reason it fails, the
    // fallback is the behaviour this plugin shipped with, not a broken one.
    const root = makeProject();
    const fs = withApi('faithful');

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
      // The log line an author would read to find out why the editor froze.
      expect(converter.detail).toContain('refused');

      const run = await importer.runOnce();
      expect(run.failed).toEqual([]);
      expect(run.converted.map((c) => c.name)).toEqual(['Ringo']);
      expect(
        readdirSync(nodePath.join(root, 'data/others/ssdata/Ringo')).some((f) =>
          f.endsWith('.ssab'),
        ),
      ).toBe(true);
    } finally {
      if (original === undefined) delete (globalThis as { Worker?: unknown }).Worker;
      else (globalThis as { Worker?: unknown }).Worker = original;
    }
  });

  it('serialises passes that overlap', async () => {
    const root = makeProject();
    const importer = importerFor(root, withApi('faithful'), []);
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

  it('gives one output folder to one project, and names the one it dropped', async () => {
    // Two projects of the same name resolve to the same `outRoot/<stem>`.
    // Converting both wrote that folder twice — the second silently replaced
    // the first — and the record they shared then said both were current, so
    // the loser was never rebuilt either.
    const root = makeEmptyProject();
    cpSync(SAMPLE, nodePath.join(root, 'SpriteStudio_Source/chara/Ringo'), { recursive: true });
    cpSync(SAMPLE, nodePath.join(root, 'SpriteStudio_Source/enemy/Ringo'), { recursive: true });

    const log: string[] = [];
    const importer = importerFor(root, withApi('faithful'), log);
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

  it('removes output it no longer produces, and nothing else', async () => {
    const root = makeProject();
    const importer = importerFor(root, withApi('faithful'), []);
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
    const importer = importerFor(root, withApi('faithful'), []);
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
    const fs = withApi('faithful');
    await importerFor(root, fs, []).runOnce();

    const statePath = nodePath.join(root, '.ss_import_state.json');
    const state = JSON.parse(readFileSync(statePath, 'utf8'));
    // What the file looked like before the key described a folder.
    writeFileSync(
      statePath,
      JSON.stringify({ packs: { Ringo: state.packs[packKey('Ringo')] } }),
      'utf8',
    );

    const fresh = importerFor(root, fs, []);
    expect(fresh.hasImported()).toBe(true);
    // Re-keyed, not re-converted: the record still describes what is on disk.
    expect((await fresh.runOnce()).skipped).toEqual(['Ringo']);
    expect(Object.keys(JSON.parse(readFileSync(statePath, 'utf8')).packs)).toEqual([
      packKey('Ringo'),
    ]);
  });

  it('knows whether this project has ever imported anything', async () => {
    // What tells a first-time project ("here is where the sources go") from
    // one whose author has since emptied the source folder.
    const root = makeProject();
    const importer = importerFor(root, withApi('faithful'), []);
    expect(importer.hasImported()).toBe(false);
    await importer.runOnce();
    expect(importer.hasImported()).toBe(true);
  });
});
