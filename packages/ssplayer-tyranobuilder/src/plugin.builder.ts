// TyranoBuilder plugin entry — built to `dist/ssplayer.builder.js` and installed
// at `<project>/data/others/plugin/ssplayer/ssplayer.builder.js`.
//
// The builder discovers plugins by looking for `<id>/<id>.builder.js` inside the
// open project, `await import()`s it, and calls `new module.plugin_setting(TB)`
// (`js/app/core/plugin.js`). That constructor is our init hook: it runs once,
// when a project is opened, which is the counterpart of Ren'Py's `init python:`
// block in `SSPlayerForRenPy/game/spritestudio/auto_importer.rpy`.
//
// The plugin does two things from there:
//   - imports SpriteStudio projects, and keeps watching for changes; and
//   - contributes the `[ss_*]` GUI components (see `components.ts`).
//
// Everything the importer does is written to `<project>/ss_import_log.txt`.

import { AutoImporter, DEFAULT_SOURCE_DIR, type ImportRunResult } from './autoImporter.js';
import type { BuilderComponentEntry, TB } from './builderTypes.js';
import { defineSSComponents } from './components.js';
import { HostFs } from './hostFs.js';
import { ImportLog } from './importLog.js';

const WASM_FILENAME = 'ssconverter_bg.wasm';

/**
 * Where editor-only files are kept, relative to the project root. An export is
 * three unfiltered copies — `index.html`, `data/`, `tyrano/` — so this folder is
 * excluded for free, while anything left in the plugin folder ships inside
 * every built game.
 */
const TOOLS_DIR = '.ss_tools';

/**
 * The converter wasm, moved out of `data/` on sight.
 *
 * A `.tbp` can only deliver files into the plugin folder, which lives under
 * `data/`; but nothing except this plugin ever reads the converter, so it does
 * not have to stay there. Relocating it keeps 1.4 MB out of every export. The
 * staged copy reappearing means a reinstall or an update, so it always wins.
 */
function relocateConverterWasm(fs: HostFs, projectRoot: string, pluginDir: string): string {
  const staged = fs.path.join(pluginDir, WASM_FILENAME);
  const kept = fs.path.join(projectRoot, TOOLS_DIR, WASM_FILENAME);

  if (fs.exists(staged)) {
    fs.mkdirp(fs.path.join(projectRoot, TOOLS_DIR));
    fs.copy(staged, kept);
    fs.remove(staged);
  }
  // Fall back to wherever it actually is, so a failed move degrades to working.
  return fs.exists(kept) ? kept : staged;
}

/** How often to re-check the source folder while the editor is open. */
const WATCH_INTERVAL_MS = 3000;

const LOG_FILENAME = 'ss_import_log.txt';

/** Directory this module was loaded from, as a filesystem path. */
function moduleDir(): string {
  let p = decodeURIComponent(new URL('.', import.meta.url).pathname);
  // file:///C:/… → C:/… on Windows.
  if (/^\/[A-Za-z]:/.test(p)) p = p.slice(1);
  return p.replace(/\/$/, '');
}

/**
 * `TB.getProjectPath()` is the documented source of truth. The fallback derives
 * the root from this module's own location — the plugin always sits at
 * `<root>/data/others/plugin/<id>/` — so a change in the builder's API surface
 * degrades to a wrong-but-recoverable path rather than a crash.
 */
function resolveProjectRoot(TB: TB | undefined, fs: HostFs, pluginDir: string): string {
  const fromTB = typeof TB?.getProjectPath === 'function' ? TB.getProjectPath() : '';
  if (fromTB) return fromTB.replace(/[\\/]$/, '');
  return fs.path.resolve(pluginDir, '..', '..', '..', '..');
}

/**
 * Callable members of a host object, prototype chain included. `TB.io` is a
 * Backbone-style model instance, so `Object.keys()` reports its instance fields
 * (`attributes`, `cid`, …) and says nothing about what can actually be called.
 */
function listMethods(obj: object): string[] {
  const names = new Set<string>();
  const source = obj as Record<string, unknown>;
  for (let o: object | null = obj; o && o !== Object.prototype; o = Object.getPrototypeOf(o)) {
    for (const key of Object.getOwnPropertyNames(o)) {
      if (key === 'constructor') continue;
      try {
        if (typeof source[key] === 'function') names.add(key);
      } catch {
        // A getter that throws tells us nothing; skip it.
      }
    }
  }
  return [...names].sort();
}

/** Report a run that did something, as a toast rather than a modal. */
function notifyRun(TB: TB | undefined, run: ImportRunResult): void {
  const t = (text: string): string => (typeof TB?.$?.s === 'function' ? TB.$.s(text) : text);
  const inform = TB?.$?.inform;
  if (typeof inform !== 'function') return;

  if (run.converted.length > 0) {
    const names = run.converted.map((c) => c.name);
    // Long lists say nothing useful; the first few plus a count do.
    const shown =
      names.length > 3 ? `${names.slice(0, 3).join(', ')} +${names.length - 3}` : names.join(', ');
    inform(`SpriteStudio: ${shown} — ${t('Converted')}`, 'success');
  }
  if (run.failed.length > 0) {
    inform(
      `SpriteStudio: ${run.failed.map((f) => f.name).join(', ')} — ${t('Failed')} (${LOG_FILENAME})`,
      'error',
    );
  }
}

/** Everything the plugin needs from the editor, resolved once at construction. */
interface Host {
  fs: HostFs;
  pluginDir: string;
  projectRoot: string;
  log: ImportLog;
  importer: AutoImporter;
}

/**
 * The importer owned by the most recent `plugin_setting`.
 *
 * The editor constructs the plugin more than once per session: opening a
 * project, installing a `.tbp`, and adding or removing any other plugin each
 * call `loadPlugins()`, which builds every plugin again. Each build starts a
 * watcher, so without this the timers would pile up and the same folder would
 * be polled several times over.
 */
let activeImporter: AutoImporter | null = null;

/**
 * Synchronous so `defineComponents()` — which the builder calls immediately
 * after the constructor — already has an importer to list packs from.
 */
function createHost(TB: TB | undefined): Host | null {
  const pluginDir = moduleDir();

  let fs: HostFs;
  try {
    fs = HostFs.fromWindow();
  } catch (e) {
    // Not fatal to the editor: log and stay out of the way.
    console.warn('[ssplayer-tyranobuilder]', (e as Error).message);
    return null;
  }

  const projectRoot = resolveProjectRoot(TB, fs, pluginDir);
  const log = new ImportLog(fs, fs.path.join(projectRoot, LOG_FILENAME));
  const importer = new AutoImporter({
    fs,
    projectRoot,
    wasmPath: relocateConverterWasm(fs, projectRoot, pluginDir),
    log: (line) => log.line(line),
    // A background reconversion happens while the author is in SpriteStudio,
    // not in the editor — a modal would steal focus from the app they are
    // actually using. `$.inform` is alertify's toast: it says the save landed
    // and then goes away.
    onChange: (run) => notifyRun(TB, run),
  });

  activeImporter?.stop();
  activeImporter = importer;

  return { fs, pluginDir, projectRoot, log, importer };
}

function describeEnvironment(log: ImportLog, TB: TB | undefined, fs: HostFs): void {
  const api = fs.api;
  log.line(`studio_api keys: ${Object.keys(api).join(', ')}`);
  log.line(
    `studio_api.fs methods: ${['readFileSync', 'writeFileSync', 'existsSync', 'readdirSync', 'statSync', 'copySync']
      .map((m) => `${m}=${typeof (api.fs as unknown as Record<string, unknown>)[m]}`)
      .join(' ')}`,
  );
  log.line(`TB keys: ${TB ? Object.keys(TB).join(', ') : '(TB not supplied)'}`);
  log.line(`TB.io methods: ${TB?.io ? listMethods(TB.io).join(', ') : '(none)'}`);
  log.line(`user agent: ${navigator.userAgent}`);
}

async function boot(host: Host, TB: TB | undefined): Promise<void> {
  const { fs, pluginDir, projectRoot, log, importer } = host;

  log.line(`plugin dir:   ${pluginDir}`);
  log.line(`project root: ${projectRoot}`);
  describeEnvironment(log, TB, fs);

  // The one genuinely undocumented step: how bytes cross the contextBridge.
  // Settle it before converting anything, or a silent mismatch would write
  // corrupt .ssab files.
  const probe = fs.probeBinaryBridge(fs.path.join(pluginDir, '.ss_bridge_probe.bin'));
  log.line(
    `binary bridge: mode=${probe.mode} write-as-buffer=${probe.writeAsBuffer} ` +
      `read-as-buffer=${probe.readAsBuffer} (${probe.detail})`,
  );

  const wasmPath = importer.wasmPath;
  log.line(`converter wasm: ${wasmPath} (${fs.statOf(wasmPath)?.size ?? 0} bytes)`);

  // Create the drop folder on first run so there is somewhere obvious to put
  // projects — the Ren'Py version simply returns when it is missing, which
  // leaves a first-time user with nothing to go on.
  if (!fs.exists(importer.sourceDir)) {
    fs.mkdirp(importer.sourceDir);
    log.line(`created source folder: ${importer.sourceDir}`);
  }
  log.line(`watching: ${importer.sourceDir}`);
  log.line(`output:   ${importer.outRoot}`);

  const run = await importer.runOnce();
  log.line(
    `first pass: ${run.converted.length} converted, ${run.skipped.length} up to date, ` +
      `${run.failed.length} failed${run.empty ? ' (no .sspj found)' : ''}`,
  );

  importer.start(WATCH_INTERVAL_MS);
  log.line(`watching for changes every ${WATCH_INTERVAL_MS}ms`);

  // Deferred either way: the constructor runs mid-boot, and alertify is nicer
  // once the editor has finished painting.
  setTimeout(() => {
    // "Everything was already up to date" is the normal case on every project
    // open. Saying so in a modal is just something to dismiss — the log has it.
    if (run.empty) {
      // The one case worth a modal: nothing to convert, so tell a first-time
      // user where projects go.
      const t = (text: string): string => (typeof TB?.$?.s === 'function' ? TB.$.s(text) : text);
      TB?.$?.alert?.(
        `<b>${t('SpriteStudio')}</b><br />` +
          `${t('Put a SpriteStudio project here, and it is converted for you:')}` +
          `<br /><b>${DEFAULT_SOURCE_DIR}/</b>`,
      );
      return;
    }
    notifyRun(TB, run);
  }, 1500);
}

/**
 * The class the builder instantiates. The name is fixed by the host:
 * `new module.plugin_setting(TB)`.
 */
export class plugin_setting {
  private readonly TB: TB | undefined;
  private readonly host: Host | null;

  // Read as plain properties by the plugin manager panel and the install dialog
  // (`js/app/window/window.js`). `plugin_img` is compared against the literal
  // 'no_image'; leaving it unset would point an <img> at `<plugin>/undefined`.
  readonly name: string;
  readonly plugin_text: string;
  readonly plugin_img = 'no_image';

  constructor(TB?: TB) {
    this.TB = TB;
    const t = (text: string): string =>
      typeof TB?.$?.s === 'function' ? TB.$.s(text) : text;
    this.name = t('SpriteStudio');
    this.plugin_text = t(
      'Put a SpriteStudio project (.sspj and its folder) in SpriteStudio_Source and it is converted automatically, every time you save it. Place the animation from the SpriteStudio components in the palette.',
    );
    // Must never throw: `loadPlugins()` does not guard the constructor, and an
    // exception here would abort loading of every plugin after this one.
    let host: Host | null = null;
    try {
      host = createHost(TB);
      if (host) void boot(host, TB).catch((e) => console.error('[ssplayer-tyranobuilder]', e));
    } catch (e) {
      console.error('[ssplayer-tyranobuilder] boot failed', e);
    }
    this.host = host;
  }

  /**
   * Contributed to `data/scenario/system/plugin_third.ks`, which the builder
   * regenerates on every load. `[plugin name="ssplayer"]` makes TyranoScript
   * run `data/others/plugin/ssplayer/init.ks` at game boot — that is the
   * runtime half (`@spritestudio/ssplayer-tyrano`). Emit nothing when it is not
   * installed, or the game would fail on a missing `init.ks`.
   */
  getPluginTag(): string {
    const host = this.host;
    if (host && host.fs.exists(host.fs.path.join(host.pluginDir, 'init.ks'))) {
      return '[plugin name="ssplayer"]\n';
    }
    return '';
  }

  /**
   * Called once, straight after a `.tbp` is installed from the plugin dialog.
   *
   * Deliberately quiet: the host already shows its own "installed" dialog, and
   * the constructor — which ran a moment ago — shows the import result, naming
   * the source folder when there was nothing to convert. A third dialog here
   * would just be something else to dismiss.
   */
  triggerInstall(): void {
    this.host?.log.line('installed from a .tbp');
  }

  /**
   * The `[ss_*]` palette entries. Called synchronously right after the
   * constructor, before the first import pass has finished — which is why the
   * pack list is a callback the `storage` dropdown resolves when it renders,
   * not an array captured here.
   */
  defineComponents(): Record<string, BuilderComponentEntry> {
    const host = this.host;
    if (!host) return {};
    return defineSSComponents({
      $: this.TB?.$ ?? (undefined as unknown as TB['$']),
      listPacks: () => host.importer.listPacks(),
      listAnimations: (storage) => host.importer.listAnimations(storage),
    });
  }
}
