// Developer-only converter plugin (IIFE). Drop this ALONGSIDE the runtime
// plugin during development; NEVER add it to a deployed game (it needs NW.js fs
// and bundles the converter WASM glue). On test-play it converts any .sspj under
// <game>/ss_source/ into .ssab under <game>/img/spritestudio/, then lets boot
// proceed — so freshly-edited animations are ready by the title screen.
//
// It mirrors SSPlayerForRenPy's dev-mode auto_importer: mtime-cached, gated on
// the boot screen. Outside NW.js it is a complete no-op.

import { getSelfScriptDir } from './rmmzGlobals.js';
import { runAutoImport } from './converter/autoImport.js';

const PLUGIN_NAME = 'ssplayer-rpgmakermz-devconvert';

function boot(): void {
  const g = globalThis as any;
  const Utils = g.Utils;
  const Scene_Boot = g.Scene_Boot;

  // Only under NW.js test-play. Deployed games (no fs) skip entirely.
  const isDev = !!(Utils && Utils.isNwjs && Utils.isNwjs() && (!Utils.isOptionValid || Utils.isOptionValid('test')));
  if (!isDev || !Scene_Boot) return;

  const params = (g.PluginManager?.parameters(PLUGIN_NAME)) || {};
  const opts = {
    sourceDir: params.sourceDir || 'ss_source',
    outDir: params.outDir || 'img/spritestudio',
    wasmPath: params.wasmPath || `${selfDirRelative()}ssconverter_bg.wasm`,
  };

  // Run one import pass and hold boot until it finishes (like the WASM gate).
  let done = false;
  runAutoImport(opts)
    .catch((e) => console.error('[ssplayer-rmmz devconvert] auto-import failed:', e))
    .finally(() => {
      done = true;
    });

  if (!Scene_Boot.prototype.__ssDevConvertGate) {
    Scene_Boot.prototype.__ssDevConvertGate = true;
    const _isReady = Scene_Boot.prototype.isReady;
    Scene_Boot.prototype.isReady = function (this: any): boolean {
      return _isReady.call(this) && done;
    };
  }

  console.log('[ssplayer-rmmz devconvert] auto-import started (test-play).');
}

// The converter WASM is read via fs relative to the game root, so we need a
// game-root-relative dir. document.currentScript.src is an absolute URL; derive
// the path portion after the game root. Falls back to js/plugins/.
function selfDirRelative(): string {
  const abs = getSelfScriptDir(); // e.g. file:///…/js/plugins/
  const marker = abs.toLowerCase().lastIndexOf('/js/plugins/');
  if (marker >= 0) return abs.slice(marker + 1); // -> "js/plugins/…/"
  return 'js/plugins/';
}

boot();
