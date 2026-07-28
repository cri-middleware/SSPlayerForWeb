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

/** The slice of jQuery this plugin uses to repopulate a `<select>` in place. */
export interface JQueryLike {
  length: number;
  find(selector: string): JQueryLike;
  empty(): JQueryLike;
  append(child: unknown): JQueryLike;
  html(value: string): JQueryLike;
  val(): string;
  val(value: string): JQueryLike;
  change(): JQueryLike;
  prop(name: string): unknown;
}

/** A placed component, as handed to `name()` / `header()` / `select_list()`. */
export interface BuilderComponentModel {
  data: {
    tag_name?: string;
    /** Attribute values — serialised verbatim by `$.tag(tag_name, pm)`. */
    pm: Record<string, unknown>;
  };
}

/** One parameter of a component: a row in the inspector panel. */
export interface BuilderParam {
  /** `Text` | `Num` | `Select` | `Check` | … (see `js/app/param/`). */
  type: string;
  name?: string;
  help?: string;
  /** `Check` only: the label beside the checkbox. */
  text?: string;
  /** `Num` only: suffix shown after the field. */
  unit?: string;
  /**
   * `Select` only. Receives the param *view*, not the component — reach the
   * component's values through `.get('component').data.pm`.
   */
  select_list?: (view?: unknown) => { name: string; val: string }[];
  /** Extra CSS class on the rendered control, so another param can find it. */
  className?: string;
  /**
   * Called when the control changes.
   *
   * The contract differs by type. `Select` stores the value first and then calls
   * `onChange(value)`. `Check` calls `onChange(value, component, $checkbox)`
   * *instead of* storing it — and `value` is always `undefined`, because the
   * host reads it into a variable declared in the branch it did not take. A
   * checkbox handler must therefore read `$checkbox.prop('checked')` and store
   * it itself, or the field silently stops saving.
   */
  onChange?: (value: unknown, component?: unknown, control?: JQueryLike) => void;
  /** jQuery-validate rules, e.g. `{ number: true }`. */
  validate?: Record<string, unknown>;
  default_val?: unknown;
}

/** The definition installed into `_map_component[tag]`. */
export interface BuilderComponent {
  name: (component: BuilderComponentModel) => string;
  /** Sub-title on the timeline card. */
  header: (component: BuilderComponentModel) => string;
  /** Picks the card template in `template/component/<type>.tmpl.html`. */
  component_type: string;
  default_view: {
    base_img_url?: string;
    /** Bare icon name; the card renders `class="tb-i-<icon>"`. */
    icon: string;
    icon_color?: string;
    /** Becomes a CSS class on the card. */
    category: string;
  };
  param_view: Record<string, unknown>;
  param: Record<string, BuilderParam>;
}

/** One entry of `defineComponents()`; the key is the KAG tag name. */
export interface BuilderComponentEntry {
  /** Palette listing (`_component_manage.plugin.components[tag]`). */
  info: {
    /** Non-zero marks a PRO-only component. */
    pro: number;
    /** Whether it is enabled in the palette out of the box. */
    default: boolean;
    name: string;
    help: string;
    icon: string;
  };
  component: BuilderComponent;
}

/**
 * The object the builder constructs plugins with: `new plugin_setting(TB)`
 * (`Builder.Core.Plugin.createTB()`).
 */
export interface TB {
  /** jQuery, with alertify's `$.alert` and the builder's `$.s` i18n lookup. */
  $: ((selector: unknown) => JQueryLike) & {
    alert?: (html: string) => void;
    /** Translates via `lang/<lang>.json`, returning the key itself when absent. */
    s?: (key: string) => string;
    /**
     * alertify's toast (`alertify.log`): non-modal, auto-dismissing. `type` is
     * `'success'` / `'error'` or omitted.
     */
    inform?: (message: string, type?: string) => void;
  };
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
