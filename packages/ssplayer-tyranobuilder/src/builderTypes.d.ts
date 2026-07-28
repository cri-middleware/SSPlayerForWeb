// Minimal ambient types for the TyranoBuilder host surface this plugin touches.
// TyranoBuilder ships no types; we model only what the auto-importer needs and
// keep it loose — the real objects have far more, and we must not over-constrain
// a foreign runtime.
//
// Everything modelled here was read off the shipped builder (Ver 3.00, Electron
// 24.8.8), under `TyranoBuilder.app/Contents/Resources/app/`:
//   - `preload.js`            — what `window.studio_api` exposes
//   - `js/app/core/plugin.js` — how plugins are loaded and what `TB` holds
//   - `js/app/core/io.js`     — the `TB.io` methods

/**
 * Node's `fs.Stats` as it survives Electron's contextBridge. Methods come
 * across as proxies, so they are optional here: callers must tolerate a plain
 * data clone with no methods (see `statOf()` in `hostFs.ts`).
 */
export interface HostStats {
  isDirectory?: () => boolean;
  isFile?: () => boolean;
  /** POSIX mode bits; the fallback when `isDirectory` did not survive. */
  mode?: number;
  size?: number;
  mtimeMs?: number;
  mtime?: string | Date | number;
}

/** The subset of `node:path` the builder exposes (whole module, actually). */
export interface HostPath {
  join(...parts: string[]): string;
  dirname(p: string): string;
  basename(p: string, ext?: string): string;
  extname(p: string): string;
  resolve(...parts: string[]): string;
  relative(from: string, to: string): string;
  readonly sep: string;
}

/** `fs-extra` (and `node:fs`) as exposed through the bridge. */
export interface HostFsModule {
  readFileSync(path: string, encoding?: string): unknown;
  writeFileSync(path: string, data: unknown, encoding?: string): void;
  existsSync(path: string): boolean;
  readdirSync(path: string): string[];
  statSync(path: string): HostStats;
  /** fs-extra: recursive copy, runs entirely on the Node side. */
  copySync(src: string, dest: string): void;
}

/**
 * `window.studio_api` — installed by the builder's `preload.js` via
 * `contextBridge.exposeInMainWorld`. This is the whole reason an in-editor
 * importer is possible at all: the renderer gets real filesystem access.
 */
export interface StudioApi {
  /** `fs-extra`. */
  fs: HostFsModule;
  /** `node:fs`. */
  fs_default: HostFsModule;
  path: HostPath;
  mkdirp: { sync(dir: string, mode?: string): void };
  admzip?: unknown;
  ipcRenderer?: unknown;
}

/** `TB.io` — the builder's own file helpers (`js/app/core/io.js`). */
export interface TBIo {
  /** Reads as utf8 and returns a string — not usable for binaries. */
  readFile(path: string): string;
  writeFile(path: string, data: unknown): void;
  saveJson(path: string, obj: unknown): void;
  loadJson(path: string): unknown;
  mkdir(path: string): void;
  copy(src: string, dest: string): void;
  exists(path: string): boolean;
}

/**
 * The object the builder constructs plugins with: `new plugin_setting(TB)`
 * (`Builder.Core.Plugin.createTB()`).
 */
export interface TB {
  /** jQuery, with alertify's `$.alert` mixed in. */
  $: ((selector: unknown) => unknown) & { alert?: (html: string) => void };
  /** Absolute path of the open project, with a trailing slash. */
  getProjectPath(): string;
  io: TBIo;
  component: unknown;
  _pm_type: unknown;
}

declare global {
  interface Window {
    studio_api?: StudioApi;
  }
}
