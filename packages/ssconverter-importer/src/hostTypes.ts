// The filesystem a host hands the importer.
//
// Modelled on what TyranoBuilder publishes as `window.studio_api` (Ver 3.00,
// Electron 24.8.8, `preload.js`), because that is the narrowest host this
// package serves: everything crosses Electron's contextBridge there, so values
// may arrive as plain clones with their methods gone. A host with `require()`
// builds the same shape from Node directly. Kept loose on purpose — the real
// objects have far more, and a foreign runtime must not be over-constrained.

/**
 * Node's `fs.Stats`, as it may survive a bridge. Methods can come across as
 * proxies or not at all, so they are optional here: callers must tolerate a
 * plain data clone with no methods (see `statOf()` in `hostFs.ts`).
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

/** The subset of `node:path` the importer uses. */
export interface HostPath {
  join(...parts: string[]): string;
  dirname(p: string): string;
  basename(p: string, ext?: string): string;
  extname(p: string): string;
  resolve(...parts: string[]): string;
  relative(from: string, to: string): string;
  readonly sep: string;
}

/** `node:fs`, plus the two `fs-extra` calls the importer relies on. */
export interface HostFsModule {
  readFileSync(path: string, encoding?: string): unknown;
  writeFileSync(path: string, data: unknown, encoding?: string): void;
  appendFileSync(path: string, data: string, encoding?: string): void;
  existsSync(path: string): boolean;
  readdirSync(path: string): string[];
  statSync(path: string): HostStats;
  /** fs-extra: recursive copy, runs entirely on the Node side. */
  copySync(src: string, dest: string): void;
  /** fs-extra: delete, no error when absent. */
  removeSync(path: string): void;
}

/**
 * Electron's `shell`, as TyranoBuilder's `preload.js` hands it to the renderer.
 *
 * The only way a plugin there can show the author a folder: there is no file
 * dialog on the bridge (`dialog` is commented out in `preload.js`) and no menu
 * on the main window. Optional, because it is undocumented and a build that
 * stopped publishing it must degrade to a panel with one less button.
 */
export interface HostShell {
  /** Opens a file or folder with the OS handler. Resolves to '' on success. */
  openPath(path: string): Promise<string> | string;
  showItemInFolder(path: string): void;
}

/** Everything `HostFs` is built on. */
export interface HostBackend {
  fs: HostFsModule;
  path: HostPath;
  mkdirp: { sync(dir: string, mode?: string): void };
  shell?: HostShell;
}
