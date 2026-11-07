// Test-play import of SpriteStudio projects: the auto-importer TyranoBuilder
// runs on project open (`@spritestudio/ssconverter-importer`), run where RPG
// Maker MZ gives a plugin a filesystem — the NW.js of a test play.
//
// The MZ editor is a native application a plugin cannot reach, so conversion
// happens at the start of a test play (event and battle tests included). One pass
// there converts every project under
// `SpriteStudio_Source/` that changed since its last successful import into
// `spritestudio/<stem>/`, the folder the plugin commands already load from,
// and holds the boot screen until it is done. F5 restarts the game, so saving
// in SpriteStudio and pressing F5 is the whole edit loop. A deployed game is
// not a test play and never converts.
//
// Opt-in by file: the pass runs only when `ssconverter_bg.wasm` sits beside
// this plugin in `js/plugins/`. Without it nothing here loads the converter,
// and a project that converts by hand is unaffected.
//
// A project that fails to convert, or that loses its folder to another project
// of the same name, stops the boot on MZ's own error screen with a Retry button
// — the treatment a missing picture gets. Retry converts again, so the author
// fixes the project in SpriteStudio, saves, and carries on from the same
// screen. Carrying on past a failure would leave the game playing the previous
// `.ssab`, which looks like an edit that did nothing.
//
// Everything is written to the console (F8) as well; nothing is written to a
// log file, because the error screen already names the project and the reason.
// The import record lives beside the sources, so the one folder an author
// leaves out of a deployment covers both.

import {
  AutoImporter,
  HostFs,
  ImportLog,
  type HostBackend,
  type ImportRunResult,
} from '@spritestudio/ssconverter-importer';
import workerSource from '@spritestudio/ssconverter-importer/worker-source';

/** Where authors put SpriteStudio projects, relative to the project root. */
export const SOURCE_DIR = 'SpriteStudio_Source';
/** Where converted packs go: the folder `showSS` paths already point into. */
export const OUT_DIR = 'spritestudio';
/** The import record. A dot file, so the source walk does not date it. */
export const STATE_FILE = `${SOURCE_DIR}/.ss_import_state.json`;
/** The converter; its presence in `js/plugins/` is what turns this on. */
export const WASM_FILE = 'ssconverter_bg.wasm';

const PREFIX = '[ssplayer-rmmz]';

type NodeRequire = (id: string) => any;

/**
 * Node's `fs` and `path`, in the shape the importer takes.
 *
 * The importer only ever copies single files (the textures beside a pack), so
 * `copySync` is `copyFileSync` rather than fs-extra's recursive copy.
 */
export function nodeBackend(req: NodeRequire): HostBackend {
  const fs = req('fs');
  return {
    fs: {
      readFileSync: (p, encoding) => fs.readFileSync(p, encoding),
      writeFileSync: (p, data, encoding) => fs.writeFileSync(p, data, encoding),
      appendFileSync: (p, data, encoding) => fs.appendFileSync(p, data, encoding),
      existsSync: (p) => fs.existsSync(p),
      readdirSync: (p) => fs.readdirSync(p),
      statSync: (p) => fs.statSync(p),
      copySync: (src, dest) => fs.copyFileSync(src, dest),
      removeSync: (p) => fs.rmSync(p, { recursive: true, force: true }),
    },
    path: req('path'),
    mkdirp: { sync: (dir) => void fs.mkdirSync(dir, { recursive: true }) },
  };
}

/** An importer writing where this plugin reads from. */
export function createImporter(
  fs: HostFs,
  projectRoot: string,
  log: (line: string) => void,
): AutoImporter {
  return new AutoImporter({
    fs,
    projectRoot,
    wasmPath: fs.path.join(projectRoot, 'js', 'plugins', WASM_FILE),
    workerSource,
    sourceDirName: SOURCE_DIR,
    outDirName: OUT_DIR,
    stateFile: STATE_FILE,
    log,
  });
}

/**
 * What stops the boot, as one line for MZ's error screen — or '' when the pass
 * left nothing for the author to fix. The screen shows a single message, so
 * the first problem is spelled out and the rest are counted.
 */
export function describeProblems(run: ImportRunResult): string {
  const problems = [
    ...run.failed.map((f) => `${f.name}: ${f.error}`),
    ...run.dropped.map(
      (d) =>
        `${d.source} was not converted: ${d.kept} already writes to ` +
        `${OUT_DIR}/${d.name}. Rename one of them.`,
    ),
  ];
  if (problems.length === 0) return '';
  const more = problems.length - 1;
  return more > 0 ? `${problems[0]} (+${more} more; see the console, F8)` : problems[0];
}

/** Whether this boot is a test play, which is the only time MZ has a `require`. */
function isTestPlay(Utils: any): boolean {
  return ['test', 'btest', 'etest'].some((option) => Utils.isOptionValid(option));
}

/**
 * Start the pass and hold `Scene_Boot` until it is done. A no-op outside a test
 * play, without the converter, and without a source folder. Idempotent.
 */
export function installAutoImport(): void {
  const g = globalThis as any;
  const { Utils, Scene_Boot, SceneManager, Graphics } = g;
  if (!Utils?.isNwjs?.() || !isTestPlay(Utils) || typeof g.require !== 'function') return;
  if (!Scene_Boot || Scene_Boot.prototype.__ssAutoImport) return;

  const fs = new HostFs(nodeBackend(g.require));
  const projectRoot = fs.path.dirname(g.process.mainModule.filename);
  // Checked before anything logs: most projects have no source folder, and
  // their test plays should not hear from this at all.
  if (!fs.exists(fs.path.join(projectRoot, SOURCE_DIR))) return;
  const log = new ImportLog(fs, null, PREFIX);
  const importer = createImporter(fs, projectRoot, (line) => log.line(line));
  if (!fs.exists(importer.wasmPath)) {
    log.line(
      `${SOURCE_DIR}/ is here but js/plugins/${WASM_FILE} is not, so nothing is converted. ` +
        `Put ${WASM_FILE} beside the plugin to convert on test play.`,
    );
    return;
  }
  Scene_Boot.prototype.__ssAutoImport = true;

  let phase: 'running' | 'done' | 'problem' = 'running';
  let problem = '';
  let shown = false;

  const run = (): void => {
    phase = 'running';
    void (async () => {
      const converter = await importer.converter().catch(() => null);
      if (converter) {
        log.line(
          `converter: ${converter.mode} — converter ${converter.version}` +
            (converter.detail ? ` — no worker: ${converter.detail}` : ''),
        );
      }
      const result = await importer.runOnce();
      log.line(
        `test-play import: ${result.converted.length} converted, ` +
          `${result.skipped.length} up to date, ${result.failed.length} failed, ` +
          `${result.dropped.length} dropped`,
      );
      problem = describeProblems(result);
      phase = problem ? 'problem' : 'done';
    })().catch((e: unknown) => {
      problem = e instanceof Error ? e.message : String(e);
      phase = 'problem';
    });
  };

  // MZ's own load-error screen, with a title of ours: `catchLoadError` would
  // print "Failed to load" and a URL, and the reason is what the author needs.
  const showProblem = (): void => {
    shown = true;
    SceneManager.stop();
    Graphics.printError('SpriteStudio conversion failed', problem);
    Graphics.showRetryButton(() => {
      shown = false;
      run();
      SceneManager.resume();
    });
  };

  const _isReady = Scene_Boot.prototype.isReady;
  Scene_Boot.prototype.isReady = function (this: any): boolean {
    const ready = _isReady.call(this);
    if (phase === 'problem' && !shown) showProblem();
    return ready && phase === 'done';
  };

  run();
}
