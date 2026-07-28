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

import { convertProjectAt, ensureConverter, type ConvertStats } from './converter.js';
import type { HostFs } from './hostFs.js';

/** Same filename Ren'Py uses, for symmetry across the two integrations. */
const MARKER_NAME = '.ss_import_ok';

/** Where authors drop their SpriteStudio projects, relative to the project root. */
export const DEFAULT_SOURCE_DIR = 'SpriteStudio_Source';

/**
 * Where the runtime expects packs: `[ss_new storage="others/ssdata/…"]`.
 * See `packages/ssplayer-tyrano/README.md`.
 */
export const DEFAULT_OUT_DIR = 'data/others/ssdata';

interface Marker {
  source_mtime: number;
  converter?: string;
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
}

export class AutoImporter {
  private readonly fs: HostFs;
  private readonly log: (line: string) => void;
  readonly sourceDir: string;
  readonly outRoot: string;
  private readonly wasmPath: string;
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(opts: AutoImporterOptions) {
    this.fs = opts.fs;
    this.log = opts.log;
    this.wasmPath = opts.wasmPath;
    const p = this.fs.path;
    this.sourceDir = p.join(opts.projectRoot, opts.sourceDirName ?? DEFAULT_SOURCE_DIR);
    this.outRoot = p.join(opts.projectRoot, opts.outDirName ?? DEFAULT_OUT_DIR);
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

  private readMarker(outDir: string): Marker | null {
    const path = this.fs.path.join(outDir, MARKER_NAME);
    if (!this.fs.exists(path)) return null;
    try {
      const marker = JSON.parse(this.fs.readText(path)) as Marker;
      return typeof marker?.source_mtime === 'number' ? marker : null;
    } catch {
      return null;
    }
  }

  private stampMarker(outDir: string, sourceMtime: number, converter: string): void {
    const marker: Marker = { source_mtime: sourceMtime, converter };
    this.fs.writeText(this.fs.path.join(outDir, MARKER_NAME), JSON.stringify(marker));
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

      const marker = this.hasOutput(outDir) ? this.readMarker(outDir) : null;
      if (marker && marker.source_mtime >= latest) {
        result.skipped.push(stem);
        continue;
      }

      try {
        const stats = convertProjectAt(this.fs, sspj, outDir, () => performance.now());
        this.stampMarker(outDir, latest, converterVer);
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
