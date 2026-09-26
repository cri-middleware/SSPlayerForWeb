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
//   - imports SpriteStudio projects, once per project open; and
//   - contributes the `[ss_*]` GUI components (see `components.ts`).
//
// Everything the importer does is written to `<project>/ss_import_log.txt`.

import workerSource from 'virtual:converter-worker';

import { AutoImporter, DEFAULT_SOURCE_DIR, type ImportRunResult } from './autoImporter.js';
import type { BuilderComponentEntry, JQueryLike, TB } from './builderTypes.js';
import { BUTTON_PARAM_TYPE, registerButtonParam } from './buttonParam.js';
import { defineSSComponents } from './components.js';
import { HostFs } from './hostFs.js';
import { ImportLog } from './importLog.js';
import {
  bindPanelButtons,
  escapeText,
  panelHtml,
  type PanelContent,
} from './managerPanel.js';

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

/**
 * What a run could not do, spelled out — or '' when it did everything.
 *
 * A toast is the right weight for "converted"; it is the wrong weight for a
 * failure, because the reason is not in it. The editor's main window is created
 * with `removeMenu()` and has no DevTools, so without this the only account of
 * why a conversion failed is a line in a text file the author would have to go
 * looking for. SSPlayerForRenPy reached the same conclusion — an importer that
 * fails silently mid-iteration looks like an importer that did nothing.
 *
 * Both problems name what the author has to change, which is why they share a
 * dialog: a failed conversion names the project and what the converter said, a
 * dropped one names the two projects that want the same folder.
 */
function problemsHtml(t: (text: string) => string, run: ImportRunResult): string {
  const lines: string[] = [];

  for (const failure of run.failed) {
    lines.push(`<b>${escapeText(failure.name)}</b><br />${escapeText(failure.error)}`);
  }
  for (const drop of run.dropped) {
    lines.push(
      `<b>${escapeText(drop.source)}</b><br />` +
        `${escapeText(t('Not converted: another project of the same name got there first'))} ` +
        `(${escapeText(drop.kept)}). ${escapeText(t('Rename one of them.'))}`,
    );
  }
  if (lines.length === 0) return '';

  return (
    `<b>${escapeText(t('SpriteStudio'))}</b><br /><br />` +
    lines.join('<br /><br />') +
    `<br /><br /><small>${escapeText(t('The whole log is in'))} ${LOG_FILENAME}</small>`
  );
}

/**
 * Report a run: a toast for what worked, a dialog for what the author has to
 * act on.
 */
function notifyRun(TB: TB | undefined, run: ImportRunResult): void {
  const t = (text: string): string => (typeof TB?.$?.s === 'function' ? TB.$.s(text) : text);
  const inform = TB?.$?.inform;

  if (run.converted.length > 0 && typeof inform === 'function') {
    const names = run.converted.map((c) => c.name);
    // Long lists say nothing useful; the first few plus a count do.
    const shown =
      names.length > 3 ? `${names.slice(0, 3).join(', ')} +${names.length - 3}` : names.join(', ');
    inform(`SpriteStudio: ${shown} — ${t('Converted')}`, 'success');
  }

  const problems = problemsHtml(t, run);
  if (!problems) return;
  if (typeof TB?.$?.alert === 'function') {
    TB.$.alert(problems);
    return;
  }
  // No alertify: say at least that something needs looking at.
  inform?.(`SpriteStudio: ${t('Failed')} (${LOG_FILENAME})`, 'error');
}

/**
 * Convert whatever is new or edited in the source folder, from the plugin
 * manager panel.
 *
 * The counterpart of a project open, not of the per-pack Reconvert: it checks
 * freshness rather than forcing, because what it exists to catch is a project
 * the editor has never seen. Forcing instead would rebuild every pack in the
 * folder to pick up one addition, and the author who wants exactly that already
 * has the button on the `[ss_new]`.
 *
 * Unlike a project open it always answers, up to date included. Silence is the
 * right reply to work nobody asked for; it is the wrong reply to a press.
 */
let importing = false;

function importNow(TB: TB | undefined, importer: AutoImporter, button: JQueryLike): void {
  // `queuePass` would serialise a second press safely, but running the same
  // pass twice tells the author nothing and takes twice as long to say it.
  if (importing) return;
  importing = true;

  const t = (text: string): string => (typeof TB?.$?.s === 'function' ? TB.$.s(text) : text);
  const label = button.val();
  button.prop('disabled', true).val(t('Converting…'));

  void importer
    // A folder of fifty projects is a long time under one unchanging word.
    // The button is the only surface this press owns, so the count goes on it.
    .runOnce((progress) => {
      button.val(`${t('Converting…')} ${progress.index}/${progress.total}`);
    })
    .then((run) => {
      if (run.empty) {
        TB?.$?.inform?.(
          `SpriteStudio: ${t('Put a SpriteStudio project here, and it is converted for you:')} ` +
            `${DEFAULT_SOURCE_DIR}/`,
        );
        return;
      }
      // A pass that dropped a project is not "up to date" — that clash is the
      // whole reason to have pressed this.
      if (
        run.converted.length === 0 &&
        run.failed.length === 0 &&
        run.dropped.length === 0
      ) {
        TB?.$?.inform?.(`SpriteStudio: ${t('Already up to date')}`, 'success');
        return;
      }
      notifyRun(TB, run);
    })
    .catch((e) => {
      console.error('[ssplayer-tyranobuilder] import failed', e);
      TB?.$?.inform?.(`SpriteStudio: ${t('Failed')} (${LOG_FILENAME})`, 'error');
    })
    .finally(() => {
      importing = false;
      // The panel may have been re-rendered underneath us, in which case this
      // restores a button nobody is looking at. Harmless, and simpler than
      // finding whichever one is on screen now.
      button.prop('disabled', false).val(label);
    });
}

/** Everything the plugin needs from the editor, resolved once at construction. */
interface Host {
  fs: HostFs;
  pluginDir: string;
  projectRoot: string;
  log: ImportLog;
  /** Where {@link ImportLog} writes, so the panel can offer to open it. */
  logPath: string;
  importer: AutoImporter;
}

/**
 * Rebuild the pack an `[ss_new]` names, and report what happened.
 *
 * Nothing else in the plugin converts after boot, so this is where the author's
 * "I changed the animation, pick it up" lands. It is deliberately not silent:
 * the whole point of pressing it is to find out whether it worked.
 */
function reconvert(TB: TB | undefined, importer: AutoImporter, storage: unknown): void {
  const t = (text: string): string => (typeof TB?.$?.s === 'function' ? TB.$.s(text) : text);
  void importer
    .reconvertPack(storage)
    .then((run) => {
      // Not one of ours: a pack an author placed in `data/` by hand has no
      // `.sspj` behind it, so there is nothing to rebuild it from.
      if (!run) {
        TB?.$?.inform?.(`SpriteStudio: ${t('Not converted from')} ${DEFAULT_SOURCE_DIR}/`);
        return;
      }
      if (run.empty) {
        TB?.$?.inform?.(`SpriteStudio: ${t('Source project not found')}`, 'error');
        return;
      }
      notifyRun(TB, run);
    })
    .catch((e) => {
      console.error('[ssplayer-tyranobuilder] reconvert failed', e);
      TB?.$?.inform?.(`SpriteStudio: ${t('Failed')} (${LOG_FILENAME})`, 'error');
    });
}

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
  const logPath = fs.path.join(projectRoot, LOG_FILENAME);
  const log = new ImportLog(fs, logPath);
  const importer = new AutoImporter({
    fs,
    projectRoot,
    wasmPath: relocateConverterWasm(fs, projectRoot, pluginDir),
    workerSource,
    log: (line) => log.line(line),
  });

  return { fs, pluginDir, projectRoot, log, logPath, importer };
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

/**
 * @param onVersions Called once the converter can say what it is and what it
 *   emits, so the panel can show the line an author quotes in a bug report.
 */
async function boot(
  host: Host,
  TB: TB | undefined,
  onVersions: (line: string) => void,
): Promise<void> {
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

  // Started before the first pass rather than by it, so this line lands above
  // the conversions it explains. `inline` is the answer to "why did the editor
  // freeze": the Worker could not be started, and the reason is on the line.
  //
  // Not fatal to the boot. Nothing here can convert if this failed, but the
  // pass below reports that as a failed run in the terms an author is reading
  // for, and stopping now would leave the log ending mid-sentence.
  try {
    const converter = await importer.converter();
    // Both formats, because a conversion emits both and this line is what
    // people copy into a bug report — the gap SSConverterGUI closed in its own
    // footer, which named only the `.ssab` one.
    const versions =
      `converter ${converter.version} ` +
      `(ssab v${converter.schema.ssab}, ssqb v${converter.schema.ssqb})`;
    log.line(
      `converter: ${converter.mode} — ${versions}` +
        (converter.detail ? ` — no worker: ${converter.detail}` : ''),
    );
    onVersions(versions);
  } catch (e) {
    log.line(`converter: unavailable (${(e as Error).message})`);
  }

  // Create the drop folder on first run so there is somewhere obvious to put
  // projects — the Ren'Py version simply returns when it is missing, which
  // leaves a first-time user with nothing to go on.
  if (!fs.exists(importer.sourceDir)) {
    fs.mkdirp(importer.sourceDir);
    log.line(`created source folder: ${importer.sourceDir}`);
  }
  log.line(`sources: ${importer.sourceDir}`);
  log.line(`output:   ${importer.outRoot}`);

  // Whether this project has ever had anything imported — read before the
  // pass, because the pass itself is what changes the answer.
  const firstTime = !importer.hasImported();

  const run = await importer.runOnce();
  log.line(
    `first pass: ${run.converted.length} converted, ${run.skipped.length} up to date, ` +
      `${run.failed.length} failed, ${run.dropped.length} dropped` +
      `${run.empty ? ' (no .sspj found)' : ''}`,
  );

  log.line(
    'one pass per project open; "Import now" in the plugin manager picks up ' +
      'later additions, Reconvert in an [ss_new] rebuilds one pack',
  );

  // Deferred either way: the constructor runs mid-boot, and alertify is nicer
  // once the editor has finished painting.
  setTimeout(() => {
    // "Everything was already up to date" is the normal case on every project
    // open. Saying so in a modal is just something to dismiss — the log has it.
    if (run.empty && firstTime) {
      // The one case worth a modal: a project that has never imported anything
      // and has nothing to import, so tell a first-time user where projects go.
      // Not for a project whose packs are already converted and whose author
      // has since emptied the source folder — that is every open from then on.
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
  private readonly t: (text: string) => string;
  /** What the panel is currently showing; see `showVersions`. */
  private readonly panel: PanelContent;

  // Read as plain properties by the plugin manager panel and the install dialog
  // (`js/app/window/window.js`). `plugin_img` is compared against the literal
  // 'no_image'; leaving it unset would point an <img> at `<plugin>/undefined`.
  readonly name: string;
  /**
   * Not `readonly`: the host reads this off the live instance every time the
   * author selects the plugin (`app.plugin.map_plugin[id].plugin_text`), so
   * rewriting it later is how the version line gets in.
   */
  plugin_text: string;
  readonly plugin_img = 'no_image';

  constructor(TB?: TB) {
    this.TB = TB;
    const t = (text: string): string =>
      typeof TB?.$?.s === 'function' ? TB.$.s(text) : text;
    this.t = t;
    this.name = t('SpriteStudio');

    // Must never throw: `loadPlugins()` does not guard the constructor, and an
    // exception here would abort loading of every plugin after this one.
    let started: Host | null = null;
    try {
      started = createHost(TB);
    } catch (e) {
      console.error('[ssplayer-tyranobuilder] boot failed', e);
    }
    const host = started;
    this.host = host;

    // Written after the host is resolved, because the panel only offers what
    // there is something behind: no filesystem bridge, no conversion; no
    // `shell` on it, no way to show a folder.
    this.panel = {
      withImport: host !== null,
      withFolders: host !== null && host.fs.canOpen,
      version: '',
    };
    this.plugin_text = panelHtml(t, this.panel);

    if (host) {
      bindPanelButtons(TB?.$, {
        import: (button) => importNow(TB, host.importer, button),
        openSource: () => host.fs.openPath(host.importer.sourceDir),
        openLog: () => host.fs.openPath(host.logPath),
      });
      // Last, so the panel is already answerable when the first pass starts
      // reporting into it.
      void boot(host, TB, (line) => this.showVersions(line)).catch((e) =>
        console.error('[ssplayer-tyranobuilder]', e),
      );
    }
  }

  /**
   * Put the converter's build line on the panel, once it is known.
   *
   * Only the property is updated: the host renders `.plugin_text` from this
   * instance whenever the plugin is selected, and the converter is up about a
   * second into a project open — long before anyone has the panel open.
   */
  private showVersions(line: string): void {
    this.panel.version = line;
    this.plugin_text = panelHtml(this.t, this.panel);
  }

  /**
   * Contributed to `data/scenario/system/plugin_third.ks`, which the builder
   * regenerates on every load. `[plugin name="ssplayer"]` makes TyranoScript
   * run `data/others/plugin/ssplayer/init.ks` at game boot — that is the
   * runtime half (`@spritestudio/ssplayer-tyranoscript`). Emit nothing when it is not
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
    // Decided here rather than in the constructor because this is where the
    // answer is consumed, and it must be an answer: `Builder.Core.Param.create()`
    // does `new Builder['Param'][type](...)` with no guard, so claiming a type
    // that did not register would blank the whole [ss_new] inspector.
    const hasButton = registerButtonParam(this.TB?.$, window.Builder);
    host.log.line(`reconvert control: ${hasButton ? BUTTON_PARAM_TYPE : 'Check (fallback)'}`);

    return defineSSComponents({
      $: this.TB?.$ ?? (undefined as unknown as TB['$']),
      listPacks: () => host.importer.listPacks(),
      listAnimations: (storage) => host.importer.listAnimations(storage),
      packContents: (storage) => host.importer.packContents(storage),
      reconvert: (storage) => reconvert(this.TB, host.importer, storage),
      buttonType: hasButton ? BUTTON_PARAM_TYPE : 'Check',
    });
  }
}
