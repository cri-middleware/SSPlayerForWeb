// The SSPlayerForRenPy auto-importer, ported to TyranoBuilder.
//
// Reference: `SSPlayerForRenPy/game/spritestudio/auto_importer.rpy`. There, an
// `init python:` block runs at every launch in developer mode, walks
// `SpriteStudio_Source/*.sspj`, reconverts whatever changed (mtime diff against
// a success marker) and writes into `game/ss_assets/`.
//
// The builder gives us the same opening — a plugin's constructor runs when the
// project is opened — so the shape is Ren'Py's, deliberately: one pass when the
// project opens, and after that nothing happens on its own.
//
// The editor could do more (it is a long-lived process, so a save could be
// noticed while it is open) and an earlier revision of this file did, driven by
// the window regaining focus. It was dropped to keep the whole family of
// players answering the same way: SSPlayerForGodot has no freshness check at
// all, only an explicit `Reconvert`. `reconvert()` below is the counterpart,
// reached from the `[ss_new]` inspector.
//
// A `.sspj` added to the source folder while the builder is open is therefore
// not picked up on its own, and the inspector that hosts `Reconvert` cannot be
// opened for it either — nothing points at a pack that does not exist yet. The
// way in is the plugin manager panel, which is not attached to anything in the
// scenario: "Import now" there runs `runOnce()`, the same freshness-checked
// pass a project open runs. See `managerPanel.ts`.
//
// The marker discipline is copied deliberately: output mtimes alone cannot tell
// you a run succeeded, because a failed conversion still leaves fresh-looking
// partial files behind. Only a marker written *after* a successful run lets the
// next run skip.
//
// What the marker records is the newest mtime across the project folder — not
// the `.sspj` alone. SpriteStudio writes only the files a save actually
// changed, so editing an animation moves the `.ssae` and leaves the `.sspj`
// untouched; keying off the manifest would miss the most ordinary edit there
// is. Ren'Py's `latest_source_mtime()` walks the folder for the same reason.

import { SSRuntimeManager } from '@spritestudio/ssplayer-core';

import {
  convertProjectAt,
  ensureConverter,
  type ConvertStats,
  type Converter,
} from './converter.js';
import type { HostFs, WalkedFile } from './hostFs.js';

/**
 * Import bookkeeping, at the project root.
 *
 * Ren'Py keeps a `.ss_import_ok` marker inside each output folder and excludes
 * it from builds with `build.classify`. TyranoBuilder's exporter has no such
 * filter — it is three `copySync` calls, one of which takes the whole of `data/`
 * — so anything written under `data/` ships inside the game. The state lives
 * outside it instead, where an export cannot reach it.
 */
const STATE_FILE = '.ss_import_state.json';

/** The old per-output-folder marker. Migrated and deleted when found. */
const LEGACY_MARKER = '.ss_import_ok';

/** Where authors drop their SpriteStudio projects, relative to the project root. */
export const DEFAULT_SOURCE_DIR = 'SpriteStudio_Source';

/**
 * Hand the editor a turn of the event loop.
 *
 * A macrotask, not a microtask: awaiting a resolved promise lets other promises
 * run but never lets the window paint, so a loop that only did that would be
 * just as frozen as one that did not yield at all.
 */
const yieldToEditor = (): Promise<void> =>
  new Promise<void>((resolve) => setTimeout(resolve, 0));

/**
 * Where the runtime expects packs: `[ss_new storage="others/ssdata/…"]`.
 * See `packages/ssplayer-tyranoscript/README.md`.
 */
export const DEFAULT_OUT_DIR = 'data/others/ssdata';

/** What one successful import covered. */
interface PackState {
  /** Newest mtime across the source project folder at the time it was read. */
  source_mtime: number;
  converter?: string;
}

interface ImportState {
  /** Keyed by `.sspj` stem, which is also the output folder's name. */
  packs: Record<string, PackState>;
}

export interface ImportRunResult {
  converted: { name: string; stats: ConvertStats }[];
  skipped: string[];
  failed: { name: string; error: string }[];
  /**
   * True when the pass found no `.sspj` to consider — an empty source folder,
   * or for a pass scoped to one pack, a source project that is no longer there.
   */
  empty: boolean;
}

/** What one pass is asked to do. */
interface PassOptions {
  /** Restrict the pass to this `.sspj` stem. Undefined means every project. */
  only?: string;
  /** Convert even when the record says the output is current. */
  force?: boolean;
}

export interface AutoImporterOptions {
  fs: HostFs;
  /** Absolute path of the open project, no trailing slash required. */
  projectRoot: string;
  /** Absolute path of `ssconverter_bg.wasm`. */
  wasmPath: string;
  /**
   * The conversion Worker's bundle, as source. Without it every conversion runs
   * on the calling thread — which is what the tests do, and what the editor
   * falls back to when it cannot start a Worker.
   */
  workerSource?: string;
  sourceDirName?: string;
  outDirName?: string;
  log: (line: string) => void;
}

export class AutoImporter {
  private readonly fs: HostFs;
  private readonly log: (line: string) => void;
  private readonly projectRoot: string;
  /** `<project>/data` — `storage=` attributes are written relative to it. */
  private readonly dataDir: string;
  /** Parsed animation lists, invalidated by a pack's mtime/size. */
  private readonly animationCache = new Map<
    string,
    { mtimeMs: number; size: number; names: string[] }
  >();
  /**
   * The pack scan, for the current task only.
   *
   * One inspector render asks for it more than once — `select_list` and
   * `default_val` on the pack picker, and the widened animation picker on top
   * of that — and the host renders those params in a single synchronous loop.
   *
   * Scoped to a task rather than validated the way `animationCache` is, because
   * nothing cheaper than the walk itself can answer "has a `.ssab` appeared";
   * a directory mtime would need the same traversal to be read. A task is
   * precisely the window in which the answer cannot have changed.
   */
  private packsThisTask: { name: string; val: string }[] | null = null;
  readonly sourceDir: string;
  readonly outRoot: string;
  readonly wasmPath: string;
  private readonly workerSource?: string;
  /** Tail of the pass queue; see `queuePass`. */
  private inFlight: Promise<void> = Promise.resolve();

  constructor(opts: AutoImporterOptions) {
    this.fs = opts.fs;
    this.log = opts.log;
    this.wasmPath = opts.wasmPath;
    this.workerSource = opts.workerSource;
    const p = this.fs.path;
    this.projectRoot = opts.projectRoot;
    this.dataDir = p.join(opts.projectRoot, 'data');
    this.sourceDir = p.join(opts.projectRoot, opts.sourceDirName ?? DEFAULT_SOURCE_DIR);
    this.outRoot = p.join(opts.projectRoot, opts.outDirName ?? DEFAULT_OUT_DIR);
  }

  /**
   * Every `.ssab` in the project, as `[ss_new storage=]` values — paths relative
   * to `data/`, which is what TyranoScript resolves storage against.
   *
   * Deliberately the whole of `data/`, not just this importer's output folder: a
   * pack is a normal asset and an author may keep one anywhere (hand-converted,
   * copied from another project, grouped next to its scene's images). Scanning
   * only `others/ssdata` would turn the picker into a cage.
   */
  listPacks(): { name: string; val: string }[] {
    if (this.packsThisTask) return this.packsThisTask;

    const packs = this.scanPacks();
    this.packsThisTask = packs;
    // Dropped on the next turn of the event loop. That is what makes this safe
    // without an invalidation hook anywhere: a conversion, or a file an author
    // drops in by hand, always reaches a later turn than the render that would
    // have shown it.
    setTimeout(() => {
      this.packsThisTask = null;
    }, 0);
    return packs;
  }

  /**
   * The scan itself: a walk of the whole of `data/`, which on a small project
   * is 43 `readdir` plus 334 `stat` — every one a synchronous hop across the
   * contextBridge — for about 9 ms. It grows with the project's total assets,
   * not with how many packs it holds.
   */
  private scanPacks(): { name: string; val: string }[] {
    const root = this.fs.exists(this.dataDir) ? this.dataDir : this.outRoot;
    if (!this.fs.exists(root)) return [];

    const packs: { name: string; val: string }[] = [];
    for (const full of this.fs.walkFiles(root)) {
      if (!full.toLowerCase().endsWith('.ssab')) continue;
      const val = this.fs.path.relative(this.dataDir, full).replace(/\\/g, '/');
      packs.push({ name: val, val });
    }

    // Imported packs first — that is where most of them come from — then the
    // rest alphabetically.
    const imported = this.fs.path.relative(this.dataDir, this.outRoot).replace(/\\/g, '/') + '/';
    return packs.sort((a, b) => {
      const rank = Number(!a.val.startsWith(imported)) - Number(!b.val.startsWith(imported));
      return rank !== 0 ? rank : a.val.localeCompare(b.val);
    });
  }

  /**
   * Animation names inside a pack, for the `anime=` picker. Reads the `.ssab`
   * directly — it is the artefact the runtime will load, so it is the only
   * honest source for what can be played.
   *
   * Returns nothing for a pack this process cannot read (a remote URL, a path
   * built from a variable); the caller keeps a free-form escape in that case.
   */
  listAnimations(storage: unknown): string[] {
    const abs = this.resolvePack(storage);
    if (!abs) return [];

    const st = this.fs.statOf(abs);
    if (!st || st.isDir) return [];

    const cached = this.animationCache.get(abs);
    if (cached && cached.mtimeMs === st.mtimeMs && cached.size === st.size) return cached.names;

    let names: string[] = [];
    try {
      names = SSRuntimeManager.extractAnimationNames(this.fs.readBinary(abs));
    } catch {
      // A half-written or corrupt pack is not worth an error dialog; an empty
      // picker plus the free-form option is a good enough signal.
      names = [];
    }
    this.animationCache.set(abs, { mtimeMs: st.mtimeMs, size: st.size, names });
    return names;
  }

  /** A `storage=` value → an absolute path, or null when it is not on disk. */
  private resolvePack(storage: unknown): string | null {
    const rel = String(storage ?? '').trim();
    // Mirrors ssplayer-tyranoscript's resolveDataPath: bare paths hang off `data/`,
    // `data/`- and `./`-prefixed ones off the project root. Remote and
    // root-absolute paths are not ours to read.
    if (!rel || /^(https?:)?\/\//.test(rel) || rel.startsWith('/')) return null;
    const p = this.fs.path;
    if (rel.startsWith('data/')) return p.join(this.projectRoot, rel);
    if (rel.startsWith('./')) return p.join(this.projectRoot, rel.slice(2));
    return p.join(this.dataDir, rel);
  }

  /** Every `.sspj` under the source folder, absolute paths. */
  findProjects(): string[] {
    return this.sspjsIn(this.fs.walkEntries(this.sourceDir));
  }

  private sspjsIn(files: WalkedFile[]): string[] {
    return files.filter((f) => f.path.toLowerCase().endsWith('.sspj')).map((f) => f.path);
  }

  /**
   * Newest mtime under each project folder — its `.sspj`, `.ssae`, `.ssce` and
   * textures — from one walk's worth of stats.
   *
   * The whole folder, not the `.sspj`: SpriteStudio writes only what a save
   * changed, so an edited animation moves its `.ssae` and leaves the manifest
   * alone. Mirrors `latest_source_mtime()` in SSPlayerForRenPy's
   * `ss_renpy/import_marker.py`, which is the canonical version of this rule.
   *
   * A project folder nested inside another counts towards both, exactly as a
   * per-folder walk would: `dir` covers everything below it.
   */
  private latestSourceMtimes(files: WalkedFile[], dirs: string[]): Map<string, number> {
    const latest = new Map(dirs.map((dir) => [dir, 0]));
    for (const file of files) {
      for (const [dir, seen] of latest) {
        if (file.mtimeMs > seen && file.path.startsWith(dir + this.fs.path.sep)) {
          latest.set(dir, file.mtimeMs);
        }
      }
    }
    return latest;
  }

  private state: ImportState | null = null;

  private loadState(): ImportState {
    if (this.state) return this.state;
    let state: ImportState = { packs: {} };
    const path = this.fs.path.join(this.projectRoot, STATE_FILE);
    if (this.fs.exists(path)) {
      try {
        const parsed = JSON.parse(this.fs.readText(path)) as ImportState;
        if (parsed?.packs && typeof parsed.packs === 'object') state = { packs: parsed.packs };
      } catch {
        // Unreadable state costs one reconversion, nothing worse.
      }
    }
    this.state = state;
    return state;
  }

  private saveState(): void {
    const path = this.fs.path.join(this.projectRoot, STATE_FILE);
    this.fs.writeText(path, JSON.stringify(this.loadState(), null, 2) + '\n');
  }

  /**
   * What the last successful import of `stem` covered, carrying over — and then
   * removing — the old in-output marker. That marker sat under `data/`, so every
   * export shipped it inside the game; a project that predates this move gets
   * cleaned up the first time it is opened.
   */
  private readMarker(stem: string, outDir: string): PackState | null {
    const state = this.loadState();
    const legacy = this.fs.path.join(outDir, LEGACY_MARKER);

    if (this.fs.exists(legacy)) {
      if (!state.packs[stem]) {
        try {
          const parsed = JSON.parse(this.fs.readText(legacy)) as PackState;
          if (typeof parsed?.source_mtime === 'number') {
            state.packs[stem] = parsed;
            this.saveState();
          }
        } catch {
          // Fall through: an unreadable marker just means one reconversion.
        }
      }
      this.fs.remove(legacy);
      this.log(`removed ${LEGACY_MARKER} from ${outDir} (import state moved out of data/)`);
    }

    const entry = state.packs[stem];
    return entry && typeof entry.source_mtime === 'number' ? entry : null;
  }

  private stampMarker(stem: string, sourceMtime: number, converter: string): void {
    this.loadState().packs[stem] = { source_mtime: sourceMtime, converter };
    this.saveState();
  }

  /**
   * Whether a previous conversion left anything behind — the guard against a
   * state file that outlived the output folder someone deleted.
   *
   * One shallow `readdir`, deliberately: recursing through the copied textures
   * every pass cost as much as the source walk itself, to answer a question the
   * top level already answers. The dot-file filter is what remains of that: a
   * folder holding only the legacy marker is not output.
   */
  private hasOutput(outDir: string): boolean {
    return this.fs.readDir(outDir).some((name) => !name.startsWith('.'));
  }

  /**
   * Convert every project whose sources no longer match its last successful
   * import. Safe to call repeatedly; an unchanged project costs one `stat` per
   * source file and a single `readdir` of its output folder.
   */
  async runOnce(): Promise<ImportRunResult> {
    return this.queuePass({});
  }

  /**
   * Rebuild the one pack a `storage=` value names, whatever its record says.
   *
   * Scoped to a single pack because the control that calls it is attached to an
   * `[ss_new]`, and that component names the pack it plays — the same shape as
   * SSPlayerForGodot's per-asset inspector button. Forcing is affordable at
   * this scope and is what "Reconvert" means: the author has already decided
   * the pack is wrong, so a freshness check would only be an opportunity to
   * disagree with them.
   *
   * Returns `null` for a pack this importer did not produce — one placed in
   * `data/` by hand has no `.sspj` to go back to.
   */
  async reconvertPack(storage: unknown): Promise<ImportRunResult | null> {
    const stem = this.stemOfPack(storage);
    if (!stem) return null;
    return this.queuePass({ only: stem, force: true });
  }

  /**
   * The `.sspj` stem behind a `storage=` value, or null when the pack does not
   * live in this importer's output folder.
   */
  private stemOfPack(storage: unknown): string | null {
    const abs = this.resolvePack(storage);
    if (!abs) return null;
    const rel = this.fs.path.relative(this.outRoot, abs).replace(/\\/g, '/');
    // `..` means it resolved outside the output root: a hand-placed pack.
    if (!rel || rel.startsWith('..')) return null;
    const stem = rel.split('/')[0];
    return stem && stem !== rel ? stem : null;
  }

  /**
   * Passes run one at a time. Project open and a `Reconvert` click are
   * independent callers that can want different work done, so a later caller
   * waits for the earlier one rather than being handed its result.
   */
  private queuePass(opts: PassOptions): Promise<ImportRunResult> {
    const next = this.inFlight.then(() => this.importPass(opts));
    this.inFlight = next.then(
      () => {},
      () => {},
    );
    return next;
  }

  /**
   * Whether a record still describes what is on disk, and what this build of
   * the converter would produce from it.
   *
   * The converter half matters because nothing else rebuilds a pack after a
   * plugin update: the version has been recorded since the first release and
   * never read, and `Reconvert` is scoped to one pack the author points at, so
   * without this a new converter would never reach the rest. A record carrying
   * no version predates this and is rebuilt once.
   */
  private isCurrent(previous: PackState, latest: number, converterVer: string): boolean {
    return previous.source_mtime >= latest && previous.converter === converterVer;
  }

  /**
   * The converter backing this importer, started on first use and shared for
   * the rest of the editor session.
   */
  converter(): Promise<Converter> {
    return ensureConverter(this.fs, { wasmPath: this.wasmPath, workerSource: this.workerSource });
  }

  private async importPass(opts: PassOptions): Promise<ImportRunResult> {
    const result: ImportRunResult = { converted: [], skipped: [], failed: [], empty: false };

    // One walk for the whole pass: it finds the projects *and* dates them. The
    // two used to be separate traversals, which statted every source file three
    // times over.
    const sourceFiles = this.fs.walkEntries(this.sourceDir);
    const all = this.sspjsIn(sourceFiles);
    const sspjs = opts.only
      ? all.filter((f) => this.fs.path.basename(f, '.sspj') === opts.only)
      : all;
    if (sspjs.length === 0) {
      // For a scoped pass this reads "the source is gone", which is exactly
      // what the caller needs to tell the author.
      result.empty = true;
      return result;
    }

    let converter: Converter;
    try {
      converter = await this.converter();
    } catch (e) {
      result.failed.push({ name: '(converter)', error: (e as Error).message });
      return result;
    }
    const converterVer = converter.version;

    const mtimes = this.latestSourceMtimes(
      sourceFiles,
      sspjs.map((f) => this.fs.path.dirname(f)),
    );

    let converted = false;
    for (const sspj of sspjs) {
      // Between projects, not before the first: a pass that skips everything —
      // the ordinary project open — must not cost a turn of the event loop per
      // project just to say so. In `worker` mode the conversion itself is the
      // yield, so this is what keeps the editor painting when there is no
      // Worker to convert in.
      if (converted && converter.mode === 'inline') await yieldToEditor();

      const stem = this.fs.path.basename(sspj, '.sspj');
      const sourceProjectDir = this.fs.path.dirname(sspj);
      const outDir = this.fs.path.join(this.outRoot, stem);
      const latest = mtimes.get(sourceProjectDir) ?? 0;

      // Unconditional, so a legacy marker is migrated and deleted even when the
      // output around it is gone.
      const previous = this.readMarker(stem, outDir);
      if (
        !opts.force &&
        previous &&
        this.isCurrent(previous, latest, converterVer) &&
        this.hasOutput(outDir)
      ) {
        result.skipped.push(stem);
        continue;
      }

      converted = true;
      try {
        const stats = await convertProjectAt(this.fs, converter, sspj, outDir, () =>
          performance.now(),
        );
        this.stampMarker(stem, latest, converterVer);
        result.converted.push({ name: stem, stats });
        this.log(
          `converted ${stem}: ${stats.inputFiles} in -> ${stats.outputFiles} out ` +
            `(+${stats.copiedAssets} textures) in ${stats.elapsedMs}ms -> ${outDir}`,
        );
      } catch (e) {
        const message = (e as Error).message ?? String(e);
        result.failed.push({ name: stem, error: message });
        this.log(`FAILED ${stem}: ${message}`);
      }
    }

    return result;
  }

}
