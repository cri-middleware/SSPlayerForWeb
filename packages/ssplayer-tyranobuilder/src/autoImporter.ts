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


import {
  convertProjectAt,
  ensureConverter,
  type ConvertStats,
  type Converter,
} from './converter.js';
import type { HostFs, WalkedFile } from './hostFs.js';
import { EMPTY_PACK, readPackContents, type PackContents } from './packContents.js';

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
  /**
   * The `.sspj` behind this folder, relative to the project root.
   *
   * The source map SSPlayerForGodot keeps in `.ssplayer_sources.cfg` and
   * SSPlayerForUnity in its importer: it is what lets a `.ssab` find its way
   * back to a project, including one the author has moved out of the folder
   * this importer writes to. Relative, so copying the whole project elsewhere
   * does not invalidate it.
   */
  source?: string;
  /**
   * What that import wrote, relative to the output folder.
   *
   * The next conversion removes whatever it no longer produces — rename an
   * animation and the old `.ssab` would otherwise stay in the pack picker and
   * ship inside every exported game. Godot cannot do this (its note says
   * removing stale output needs the converter to report what it wrote); here
   * the converter does report it, so the rule can be the narrow one: nothing
   * is ever deleted but a file this importer recorded writing.
   */
  files?: string[];
}

interface ImportState {
  /**
   * Keyed by output folder — relative to the project root, `/` separators,
   * e.g. `data/others/ssdata/Ringo`.
   *
   * It was the `.sspj` stem until a record had to describe a folder outside
   * `outRoot` (a pack the author copied elsewhere under `data/`, reconverted
   * where it lies). A key with no `/` in it is one of those older records and
   * is migrated on load.
   */
  packs: Record<string, PackState>;
}

export interface ImportRunResult {
  converted: { name: string; stats: ConvertStats }[];
  skipped: string[];
  failed: { name: string; error: string }[];
  /**
   * Projects that were not converted because another project had already
   * claimed the folder they would have written into. Reported rather than
   * dropped quietly, because the fix is the author's — the same judgement as
   * SSPlayerForGodot's `_dedupe_plan`.
   */
  dropped: { name: string; source: string; kept: string }[];
  /**
   * True when the pass found no `.sspj` to consider — an empty source folder,
   * or for a pass scoped to one pack, a source project that is no longer there.
   */
  empty: boolean;
}

/** Where a pass is in its work, for a caller that has somewhere to show it. */
export interface ImportProgress {
  /** 1-based index of the project being converted. */
  index: number;
  total: number;
  name: string;
}

/** One conversion a pass intends to run. */
interface PlannedJob {
  /** Absolute path of the `.sspj`. */
  sspj: string;
  /** Absolute path of the folder its output goes into. */
  outDir: string;
  /** What a report calls it: the `.sspj` stem. */
  name: string;
}

/** What one pass is asked to do. */
interface PassOptions {
  /**
   * Run exactly these, instead of planning from the source folder. This is the
   * `Reconvert` route, which is anchored on a `.ssab` and so knows its
   * destination before the pass starts.
   */
  jobs?: PlannedJob[];
  /** Convert even when the record says the output is current. */
  force?: boolean;
  onProgress?: (progress: ImportProgress) => void;
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
  /** Parsed pack contents, invalidated by a pack's mtime/size. */
  private readonly packCache = new Map<
    string,
    { mtimeMs: number; size: number; contents: PackContents }
  >();
  /**
   * The pack scan, for the current task only.
   *
   * One inspector render asks for it more than once — `select_list` and
   * `default_val` on the pack picker, and the widened animation picker on top
   * of that — and the host renders those params in a single synchronous loop.
   *
   * Scoped to a task rather than validated the way `packCache` is, because
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

  /** Animation names inside a pack, for the `anime=` picker. */
  listAnimations(storage: unknown): string[] {
    return this.packContents(storage).animations;
  }

  /**
   * Animations, parts and cells inside a pack, for the inspector's pickers.
   * Reads the `.ssab` directly — it is the artefact the runtime will load, so
   * it is the only honest source for what a tag can name.
   *
   * Empty for a pack this process cannot read (a remote URL, a path built from
   * a variable); the caller keeps a free-form escape in that case.
   */
  packContents(storage: unknown): PackContents {
    const abs = this.resolvePack(storage);
    if (!abs) return EMPTY_PACK;

    const st = this.fs.statOf(abs);
    if (!st || st.isDir) return EMPTY_PACK;

    const cached = this.packCache.get(abs);
    if (cached && cached.mtimeMs === st.mtimeMs && cached.size === st.size) return cached.contents;

    let contents = EMPTY_PACK;
    try {
      contents = readPackContents(this.fs.readBinary(abs));
    } catch {
      // A half-written or corrupt pack is not worth an error dialog; an empty
      // picker plus the free-form option is a good enough signal.
    }
    this.packCache.set(abs, { mtimeMs: st.mtimeMs, size: st.size, contents });
    return contents;
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

  /** A path below the project root, as the state file and the log write it. */
  private relative(from: string, to: string): string {
    return this.fs.path.relative(from, to).replace(/\\/g, '/');
  }

  /** The state key for an output folder. */
  private outKey(outDir: string): string {
    return this.relative(this.projectRoot, outDir);
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
    const migrated = this.migrateKeys(state);
    this.state = migrated.state;
    // Written back now rather than left for the first conversion to carry: a
    // pass that skips everything never saves, and the file would keep a shape
    // nothing writes any more for as long as the project stayed unchanged.
    if (migrated.changed) this.saveState();
    return this.state;
  }

  /**
   * Records written when the key was the `.sspj` stem, re-keyed onto the folder
   * they describe. Nothing else changes: an entry keeps its mtime, so a
   * migrated project is not reconverted for the sake of it.
   */
  private migrateKeys(state: ImportState): { state: ImportState; changed: boolean } {
    const packs: Record<string, PackState> = {};
    let changed = false;
    for (const [key, entry] of Object.entries(state.packs)) {
      const moved = key.includes('/') ? key : this.outKey(this.fs.path.join(this.outRoot, key));
      if (moved !== key) changed = true;
      packs[moved] = entry;
    }
    return { state: { packs }, changed };
  }

  private saveState(): void {
    const path = this.fs.path.join(this.projectRoot, STATE_FILE);
    this.fs.writeText(path, JSON.stringify(this.loadState(), null, 2) + '\n');
  }

  /** Whether this project has ever had a pack imported into it. */
  hasImported(): boolean {
    return Object.keys(this.loadState().packs).length > 0;
  }

  /**
   * What the last successful import of this folder covered, carrying over — and
   * then removing — the old in-output marker. That marker sat under `data/`, so
   * every export shipped it inside the game; a project that predates this move
   * gets cleaned up the first time it is opened.
   */
  private readMarker(outDir: string): PackState | null {
    const state = this.loadState();
    const key = this.outKey(outDir);
    const legacy = this.fs.path.join(outDir, LEGACY_MARKER);

    if (this.fs.exists(legacy)) {
      if (!state.packs[key]) {
        try {
          const parsed = JSON.parse(this.fs.readText(legacy)) as PackState;
          if (typeof parsed?.source_mtime === 'number') {
            state.packs[key] = parsed;
            this.saveState();
          }
        } catch {
          // Fall through: an unreadable marker just means one reconversion.
        }
      }
      this.fs.remove(legacy);
      this.log(`removed ${LEGACY_MARKER} from ${outDir} (import state moved out of data/)`);
    }

    const entry = state.packs[key];
    return entry && typeof entry.source_mtime === 'number' ? entry : null;
  }

  private stampMarker(
    job: PlannedJob,
    sourceMtime: number,
    converter: string,
    files: string[],
  ): void {
    this.loadState().packs[this.outKey(job.outDir)] = {
      source_mtime: sourceMtime,
      converter,
      source: this.relative(this.projectRoot, job.sspj),
      files,
    };
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
  async runOnce(onProgress?: (progress: ImportProgress) => void): Promise<ImportRunResult> {
    return this.queuePass({ onProgress });
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
   * Returns `null` for a pack with no `.sspj` behind it — one an author placed
   * in `data/` by hand has nothing to be rebuilt from.
   */
  async reconvertPack(storage: unknown): Promise<ImportRunResult | null> {
    const resolved = this.resolveReconvert(storage);
    if (resolved === 'unknown') return null;
    if (resolved === 'missing') {
      return { converted: [], skipped: [], failed: [], dropped: [], empty: true };
    }
    return this.queuePass({ jobs: [resolved], force: true });
  }

  /**
   * The conversion behind a `storage=` value.
   *
   * It writes into the folder the `.ssab` is in, not into `outRoot/<stem>`:
   * a pack is an ordinary asset and an author may have moved or copied one
   * elsewhere under `data/`, and rebuilding it anywhere but where it lies would
   * refresh a file nothing in the scenario points at. SSPlayerForUnity's
   * `ReconvertInto` and SSPlayerForGodot's `queue_reconvert` draw the same line.
   *
   * `'unknown'` is "no source to rebuild this from"; `'missing'` is "we know
   * which project produced it, and that project is gone" — which the author
   * needs told apart.
   */
  private resolveReconvert(storage: unknown): PlannedJob | 'unknown' | 'missing' {
    const abs = this.resolvePack(storage);
    if (!abs) return 'unknown';

    const p = this.fs.path;
    const outDir = p.dirname(abs);
    const recorded = this.loadState().packs[this.outKey(outDir)]?.source;

    const sspj =
      (recorded ? p.join(this.projectRoot, recorded) : null) ??
      // A pack copied out of the output folder: the record naming the file is
      // the one that produced it, as long as only one did.
      this.ownerOfPackFile(p.basename(abs)) ??
      // No record at all — a deleted state file, or a project that predates
      // one. The folder's own name is the stem, which is how this worked
      // before the source map existed.
      this.stemSourceFor(outDir);

    if (!sspj) return 'unknown';
    if (!this.fs.exists(sspj)) return 'missing';
    return { sspj, outDir, name: p.basename(sspj, '.sspj') };
  }

  /** The `.sspj` that wrote a pack file of this name, when exactly one did. */
  private ownerOfPackFile(fileName: string): string | null {
    const sources = Object.values(this.loadState().packs)
      .filter((entry) => entry.source && entry.files?.includes(fileName))
      .map((entry) => this.fs.path.join(this.projectRoot, entry.source as string));
    return sources.length === 1 ? sources[0] : null;
  }

  /** The `.sspj` whose stem names this folder, for a pack under `outRoot`. */
  private stemSourceFor(outDir: string): string | null {
    const rel = this.relative(this.outRoot, outDir);
    if (!rel || rel.startsWith('..') || rel.includes('/')) return null;
    const matches = this.findProjects().filter(
      (f) => this.fs.path.basename(f, '.sspj') === rel,
    );
    return matches.length === 1 ? matches[0] : null;
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

  /**
   * One conversion per output folder.
   *
   * Two `.sspj` of the same name — `chara/hero.sspj` and `enemy/hero.sspj` —
   * both resolve to `outRoot/hero`, and converting both wrote one folder twice:
   * the second silently replaced the first, and the shared record then said
   * both were up to date, so the loser was never built again. The first keeps
   * the folder and the rest are reported, because renaming one is the author's
   * call and dropping them quietly would look like the converter lost a file.
   * SSPlayerForGodot's `_dedupe_plan` and SSPlayerForUnity's `DedupePlan` are
   * the same decision.
   */
  private planProjects(sspjs: string[]): {
    jobs: PlannedJob[];
    dropped: ImportRunResult['dropped'];
  } {
    const jobs: PlannedJob[] = [];
    const dropped: ImportRunResult['dropped'] = [];
    const owner = new Map<string, PlannedJob>();

    for (const sspj of sspjs) {
      const name = this.fs.path.basename(sspj, '.sspj');
      const outDir = this.fs.path.join(this.outRoot, name);
      const taken = owner.get(outDir);
      if (taken) {
        dropped.push({
          name,
          source: this.relative(this.sourceDir, sspj),
          kept: this.relative(this.sourceDir, taken.sspj),
        });
        continue;
      }
      const job: PlannedJob = { sspj, outDir, name };
      owner.set(outDir, job);
      jobs.push(job);
    }

    return { jobs, dropped };
  }

  /**
   * Delete what the previous import of this folder wrote and this one did not.
   *
   * Only ever the files a record says this importer wrote: the output folder is
   * an ordinary folder under `data/`, an author may keep their own files beside
   * a pack, and not claiming a file is cheaper than being careful about
   * deleting one. A record with no file list predates this and prunes nothing;
   * the conversion that reads it writes one.
   */
  private pruneStale(outDir: string, previous: PackState | null, written: string[]): string[] {
    if (!previous?.files?.length) return [];

    const kept = new Set(written);
    const removed: string[] = [];
    for (const rel of previous.files) {
      if (kept.has(rel)) continue;
      let target: string;
      try {
        target = this.fs.resolveWithin(outDir, rel, 'stale output path');
      } catch {
        continue;
      }
      if (!this.fs.exists(target)) continue;
      this.fs.remove(target);
      removed.push(rel);
    }
    return removed;
  }

  private async importPass(opts: PassOptions): Promise<ImportRunResult> {
    const result: ImportRunResult = {
      converted: [],
      skipped: [],
      failed: [],
      dropped: [],
      empty: false,
    };

    // One walk for the whole pass: it finds the projects *and* dates them. The
    // two used to be separate traversals, which statted every source file three
    // times over. A scoped pass already knows its project, so it walks only
    // that folder.
    let jobs: PlannedJob[];
    let sourceFiles: WalkedFile[];
    if (opts.jobs) {
      jobs = opts.jobs;
      sourceFiles = jobs.flatMap((job) =>
        this.fs.walkEntries(this.fs.path.dirname(job.sspj)),
      );
    } else {
      sourceFiles = this.fs.walkEntries(this.sourceDir);
      const plan = this.planProjects(this.sspjsIn(sourceFiles));
      jobs = plan.jobs;
      result.dropped = plan.dropped;
      for (const drop of plan.dropped) {
        this.log(
          `not converted: ${drop.source} — ${drop.kept} already writes to ` +
            `${this.outKey(this.fs.path.join(this.outRoot, drop.name))}`,
        );
      }
    }

    if (jobs.length === 0) {
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
      jobs.map((job) => this.fs.path.dirname(job.sspj)),
    );

    let converted = false;
    for (const [index, job] of jobs.entries()) {
      // Between projects, not before the first: a pass that skips everything —
      // the ordinary project open — must not cost a turn of the event loop per
      // project just to say so. In `worker` mode the conversion itself is the
      // yield, so this is what keeps the editor painting when there is no
      // Worker to convert in.
      if (converted && converter.mode === 'inline') await yieldToEditor();

      const { name, outDir } = job;
      const sourceProjectDir = this.fs.path.dirname(job.sspj);
      const latest = mtimes.get(sourceProjectDir) ?? 0;

      // Unconditional, so a legacy marker is migrated and deleted even when the
      // output around it is gone.
      const previous = this.readMarker(outDir);
      if (
        !opts.force &&
        previous &&
        this.isCurrent(previous, latest, converterVer) &&
        this.hasOutput(outDir)
      ) {
        result.skipped.push(name);
        continue;
      }

      converted = true;
      opts.onProgress?.({ index: index + 1, total: jobs.length, name });
      try {
        const stats = await convertProjectAt(this.fs, converter, job.sspj, outDir, () =>
          performance.now(),
        );
        const removed = this.pruneStale(outDir, previous, stats.written);
        this.stampMarker(job, latest, converterVer, stats.written);
        result.converted.push({ name, stats });
        this.log(
          `converted ${name}: ${stats.inputFiles} in -> ${stats.outputFiles} out ` +
            `(+${stats.copiedAssets} textures) in ${stats.elapsedMs}ms -> ${outDir}`,
        );
        if (removed.length > 0) {
          this.log(`removed from ${outDir}, no longer produced: ${removed.join(', ')}`);
        }
      } catch (e) {
        const message = (e as Error).message ?? String(e);
        result.failed.push({ name, error: message });
        this.log(`FAILED ${name}: ${message}`);
      }
    }

    return result;
  }
}
