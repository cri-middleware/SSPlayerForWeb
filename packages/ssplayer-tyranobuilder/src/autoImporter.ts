// The SSPlayerForRenPy auto-importer, ported to TyranoBuilder.
//
// Reference: `SSPlayerForRenPy/game/spritestudio/auto_importer.rpy`. There, an
// `init python:` block runs at every launch in developer mode, walks
// `SpriteStudio_Source/*.sspj`, reconverts whatever changed (mtime diff against
// a success marker) and writes into `game/ss_assets/`.
//
// The builder gives us the same opening — a plugin's constructor runs when the
// project is opened — and one thing Ren'Py cannot offer: the editor is a
// long-lived process, so we can keep polling while it is open. Save in
// SpriteStudio, and the `.ssab` is rebuilt seconds later without touching the
// editor at all; Ren'Py needs a relaunch.
//
// The marker discipline is copied deliberately: output mtimes alone cannot tell
// you a run succeeded, because a failed conversion still leaves fresh-looking
// partial files behind. Only a marker written *after* a successful run lets the
// next run skip.

import { SSRuntimeManager } from '@spritestudio/ssplayer-core';

import { convertProjectAt, ensureConverter, type ConvertStats } from './converter.js';
import type { HostFs } from './hostFs.js';

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
 * Where the runtime expects packs: `[ss_new storage="others/ssdata/…"]`.
 * See `packages/ssplayer-tyrano/README.md`.
 */
export const DEFAULT_OUT_DIR = 'data/others/ssdata';

/** What one successful import covered. */
interface PackState {
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
  /** True when the source folder holds no `.sspj` at all. */
  empty: boolean;
}

export interface AutoImporterOptions {
  fs: HostFs;
  /** Absolute path of the open project, no trailing slash required. */
  projectRoot: string;
  /** Absolute path of `ssconverter_bg.wasm`. */
  wasmPath: string;
  sourceDirName?: string;
  outDirName?: string;
  log: (line: string) => void;
  /**
   * Called after a *watch* pass that actually did something. Not called for the
   * quiet passes, which are almost all of them — this is the hook for telling
   * the author their save was picked up.
   */
  onChange?: (result: ImportRunResult) => void;
}

export class AutoImporter {
  private readonly fs: HostFs;
  private readonly log: (line: string) => void;
  private readonly onChange?: (result: ImportRunResult) => void;
  private readonly projectRoot: string;
  /** `<project>/data` — `storage=` attributes are written relative to it. */
  private readonly dataDir: string;
  /** Parsed animation lists, invalidated by a pack's mtime/size. */
  private readonly animationCache = new Map<
    string,
    { mtimeMs: number; size: number; names: string[] }
  >();
  readonly sourceDir: string;
  readonly outRoot: string;
  readonly wasmPath: string;
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(opts: AutoImporterOptions) {
    this.fs = opts.fs;
    this.log = opts.log;
    this.onChange = opts.onChange;
    this.wasmPath = opts.wasmPath;
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
    // Mirrors ssplayer-tyrano's resolveDataPath: bare paths hang off `data/`,
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
    if (!this.fs.exists(this.sourceDir)) return [];
    return this.fs.walkFiles(this.sourceDir).filter((f) => f.toLowerCase().endsWith('.sspj'));
  }

  /** Newest mtime across a project folder (its `.sspj`, `.ssae`, `.ssce`, textures). */
  private latestSourceMtime(dir: string): number {
    let latest = 0;
    for (const f of this.fs.walkFiles(dir)) {
      const st = this.fs.statOf(f);
      if (st && st.mtimeMs > latest) latest = st.mtimeMs;
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

  private hasOutput(outDir: string): boolean {
    if (!this.fs.exists(outDir)) return false;
    return this.fs
      .walkFiles(outDir)
      .some((f) => !this.fs.path.basename(f).startsWith('.'));
  }

  /**
   * Convert every project whose sources are newer than its last successful
   * import. Safe to call repeatedly; unchanged projects cost a few `stat`s.
   */
  async runOnce(): Promise<ImportRunResult> {
    const result: ImportRunResult = { converted: [], skipped: [], failed: [], empty: false };

    const sspjs = this.findProjects();
    if (sspjs.length === 0) {
      result.empty = true;
      return result;
    }

    let converterVer: string;
    try {
      converterVer = await ensureConverter(this.fs, this.wasmPath);
    } catch (e) {
      result.failed.push({ name: '(converter)', error: (e as Error).message });
      return result;
    }

    for (const sspj of sspjs) {
      const stem = this.fs.path.basename(sspj, '.sspj');
      const sourceProjectDir = this.fs.path.dirname(sspj);
      const outDir = this.fs.path.join(this.outRoot, stem);
      const latest = this.latestSourceMtime(sourceProjectDir);

      // Unconditional, so a legacy marker is migrated and deleted even when the
      // output around it is gone.
      const previous = this.readMarker(stem, outDir);
      if (previous && previous.source_mtime >= latest && this.hasOutput(outDir)) {
        result.skipped.push(stem);
        continue;
      }

      try {
        const stats = convertProjectAt(this.fs, sspj, outDir, () => performance.now());
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

  /**
   * Keep watching while the editor is open. This is the part Ren'Py has no
   * equivalent for — no reopen, no restart, just save in SpriteStudio.
   */
  start(intervalMs: number): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      if (this.running) return;
      this.running = true;
      void this.runOnce()
        .then((result) => {
          if (result.converted.length > 0 || result.failed.length > 0) {
            this.onChange?.(result);
          }
        })
        .catch((e) => this.log(`watch error: ${(e as Error).message}`))
        .finally(() => {
          this.running = false;
        });
    }, intervalMs);
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }
}
