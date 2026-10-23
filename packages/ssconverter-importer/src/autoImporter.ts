// The SSPlayerForRenPy auto-importer, for the hosts in this repository that can
// reach a filesystem.
//
// Reference: `SSPlayerForRenPy/game/spritestudio/auto_importer.rpy`. There, an
// `init python:` block runs at every launch in developer mode, walks
// `SpriteStudio_Source/*.sspj`, reconverts whatever changed (mtime diff against
// a success marker) and writes into `game/ss_assets/`. A host calls `runOnce()`
// at its own equivalent of that moment, and after that nothing happens on its
// own. Ren'Py's block runs again whenever its autoreload reloads the game; the
// hosts here have no such reload to ride, and SSPlayerForGodot has no freshness
// check at all, only an explicit `Reconvert`.
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

/**
 * Import bookkeeping, relative to the project root, unless the host says
 * otherwise.
 *
 * Ren'Py keeps a `.ss_import_ok` marker inside each output folder and excludes
 * it from builds with `build.classify`. Not every host's export has such a
 * filter, so the state lives outside the output folder, somewhere the host
 * knows its export does not reach.
 */
export const DEFAULT_STATE_FILE = '.ss_import_state.json';

/** Where authors drop their SpriteStudio projects, relative to the project root. */
export const DEFAULT_SOURCE_DIR = 'SpriteStudio_Source';

/**
 * Hand the host a turn of the event loop.
 *
 * A macrotask, not a microtask: awaiting a resolved promise lets other promises
 * run but never lets the window paint, so a loop that only did that would be
 * just as frozen as one that did not yield at all.
 */
const yieldToHost = (): Promise<void> =>
  new Promise<void>((resolve) => setTimeout(resolve, 0));

/** What one successful import covered. */
export interface PackState {
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
   * animation and the old `.ssab` would otherwise stay in the host's pack
   * lists and ship inside every exported game. Godot cannot do this (its note
   * says removing stale output needs the converter to report what it wrote);
   * here the converter does report it, so the rule can be the narrow one:
   * nothing is ever deleted but a file this importer recorded writing.
   */
  files?: string[];
}

export interface ImportState {
  /**
   * Keyed by output folder — relative to the project root, `/` separators,
   * e.g. `data/others/ssdata/Ringo`.
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
export interface PlannedJob {
  /** Absolute path of the `.sspj`. */
  sspj: string;
  /** Absolute path of the folder its output goes into. */
  outDir: string;
  /** What a report calls it: the `.sspj` stem. */
  name: string;
}

/** What one pass is asked to do. */
export interface PassOptions {
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
   * The conversion Worker's bundle, as source (`./worker-source`). Without it
   * every conversion runs on the calling thread — which is what the tests do,
   * and what a host falls back to when it cannot start a Worker.
   */
  workerSource?: string;
  sourceDirName?: string;
  /** Where packs are written, relative to the project root. */
  outDirName: string;
  /** Where the import state is kept, relative to the project root. */
  stateFile?: string;
  log: (line: string) => void;
}

export class AutoImporter {
  protected readonly fs: HostFs;
  protected readonly log: (line: string) => void;
  protected readonly projectRoot: string;
  readonly sourceDir: string;
  readonly outRoot: string;
  readonly wasmPath: string;
  private readonly statePath: string;
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
    this.sourceDir = p.join(opts.projectRoot, opts.sourceDirName ?? DEFAULT_SOURCE_DIR);
    this.outRoot = p.join(opts.projectRoot, opts.outDirName);
    this.statePath = p.join(opts.projectRoot, opts.stateFile ?? DEFAULT_STATE_FILE);
  }

  /** Every `.sspj` under the source folder, absolute paths. */
  findProjects(): string[] {
    return this.sspjsIn(this.fs.walkEntries(this.sourceDir));
  }

  private sspjsIn(files: WalkedFile[]): string[] {
    return files.filter((f) => f.path.toLowerCase().endsWith('.sspj')).map((f) => f.path);
  }

  /** A path below the project root, as the state file and the log write it. */
  protected relative(from: string, to: string): string {
    return this.fs.path.relative(from, to).replace(/\\/g, '/');
  }

  /** The state key for an output folder. */
  protected outKey(outDir: string): string {
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

  protected loadState(): ImportState {
    if (this.state) return this.state;
    let state: ImportState = { packs: {} };
    if (this.fs.exists(this.statePath)) {
      try {
        const parsed = JSON.parse(this.fs.readText(this.statePath)) as ImportState;
        if (parsed?.packs && typeof parsed.packs === 'object') state = { packs: parsed.packs };
      } catch {
        // Unreadable state costs one reconversion, nothing worse.
      }
    }
    const migrated = this.migrateState(state);
    this.state = migrated.state;
    // Written back now rather than left for the first conversion to carry: a
    // pass that skips everything never saves, and the file would keep a shape
    // nothing writes any more for as long as the project stayed unchanged.
    if (migrated.changed) this.saveState();
    return this.state;
  }

  /**
   * Bring a state file an older build of the host wrote up to date, before
   * anything reads it. Nothing to do unless the host has had an older shape.
   */
  protected migrateState(state: ImportState): { state: ImportState; changed: boolean } {
    return { state, changed: false };
  }

  protected saveState(): void {
    this.fs.mkdirp(this.fs.path.dirname(this.statePath));
    this.fs.writeText(this.statePath, JSON.stringify(this.loadState(), null, 2) + '\n');
  }

  /** Whether this project has ever had a pack imported into it. */
  hasImported(): boolean {
    return Object.keys(this.loadState().packs).length > 0;
  }

  /** What the last successful import of this folder covered. */
  protected readMarker(outDir: string): PackState | null {
    const entry = this.loadState().packs[this.outKey(outDir)];
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
   * top level already answers. Dot files do not count: a folder holding only a
   * marker is not output.
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
   * Passes run one at a time. A host's startup pass and a `Reconvert` click are
   * independent callers that can want different work done, so a later caller
   * waits for the earlier one rather than being handed its result.
   */
  protected queuePass(opts: PassOptions): Promise<ImportRunResult> {
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
   * the rest of the host session.
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
   * an ordinary folder of the host's, an author may keep their own files beside
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
      // the ordinary startup — must not cost a turn of the event loop per
      // project just to say so. In `worker` mode the conversion itself is the
      // yield, so this is what keeps the host painting when there is no
      // Worker to convert in.
      if (converted && converter.mode === 'inline') await yieldToHost();

      const { name, outDir } = job;
      const sourceProjectDir = this.fs.path.dirname(job.sspj);
      const latest = mtimes.get(sourceProjectDir) ?? 0;

      // Unconditional, so a host that migrates an older marker here does so
      // even when the output around it is gone.
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
