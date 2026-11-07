// The auto-importer as TyranoBuilder uses it.
//
// A plugin's constructor runs when the project is opened, so the first pass runs
// then. The builder has no reload for a plugin to ride, so after that nothing
// happens on its own.
//
// There is no check on window focus; the only way in is an explicit `Reconvert`:
// `reconvertPack()` below, reached from the `[ss_new]` inspector.
//
// A `.sspj` added to the source folder while the builder is open is therefore
// not picked up on its own, and the inspector that hosts `Reconvert` cannot be
// opened for it either — nothing points at a pack that does not exist yet. The
// way in is the plugin manager panel, which is not attached to anything in the
// scenario: "Import now" there runs `runOnce()`, the same freshness-checked
// pass a project open runs. See `managerPanel.ts`.
//
// What this adds to the shared importer is the editor's side of a pack: the
// pickers that list packs and read what is inside them, and `Reconvert`, which
// is anchored on a `storage=` value rather than on a source folder.

import {
  AutoImporter,
  type AutoImporterOptions,
  type ImportRunResult,
  type PlannedJob,
} from '@spritestudio/ssconverter-importer';

import { EMPTY_PACK, readPackContents, type PackContents } from './packContents.js';

/**
 * Where the runtime expects packs: `[ss_new storage="others/ssdata/…"]`.
 * See `packages/ssplayer-tyranoscript/README.md`.
 */
export const DEFAULT_OUT_DIR = 'data/others/ssdata';

export type BuilderImporterOptions = Omit<AutoImporterOptions, 'outDirName'> & {
  outDirName?: string;
};

export class BuilderImporter extends AutoImporter {
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

  constructor(opts: BuilderImporterOptions) {
    super({ ...opts, outDirName: opts.outDirName ?? DEFAULT_OUT_DIR });
    this.dataDir = this.fs.path.join(opts.projectRoot, 'data');
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

  /**
   * Rebuild the one pack a `storage=` value names, whatever its record says.
   *
   * Scoped to a single pack because the control that calls it is attached to an
   * `[ss_new]`, and that component names the pack it plays. Forcing is affordable at
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
   * refresh a file nothing in the scenario points at.
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
}
