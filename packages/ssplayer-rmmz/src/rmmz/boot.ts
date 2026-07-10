// WASM boot synchronisation (spec §8.3).
//
// ssplayer-core needs its WASM runtime initialised once before any SSPlayer is
// used. We kick that off the moment the plugin loads and hold the promise, then
// hook Scene_Boot.isReady so MZ's "Now Loading" screen stays up until the WASM
// is compiled — exactly how the bundled Effekseer plugin gates boot. By the time
// the title screen appears, the runtime is guaranteed ready.

import { SSPlayer } from '../SSPlayer.js';

let _wasmReady = false; // init settled (success OR failure) — releases the boot gate
let _wasmOk = false; // init SUCCEEDED — safe to construct players
let _bootPromise: Promise<void> | null = null;

/**
 * Begin WASM init (idempotent) and install the Scene_Boot.isReady gate.
 * @param wasmPath URL to `ssruntime_bg.wasm` (approach A — external file). When
 *                 omitted, wasm-bindgen's default resolution is attempted.
 */
export function installWasmBootGate(wasmPath?: string): Promise<void> {
  if (_bootPromise) return _bootPromise;

  _bootPromise = SSPlayer.initialize(wasmPath ? wasmPath : undefined)
    .then(() => {
      _wasmOk = true;
      _wasmReady = true;
    })
    .catch((err) => {
      // Never hang boot: if WASM fails (e.g. the NW.js/Chromium build has no
      // WebAssembly SIMD), log a clear message and let the game start — SS
      // animations are disabled but the game runs normally (players are not
      // constructed while !isWasmOk(), so no secondary error is thrown).
      console.error(
        '[ssplayer-rmmz] WASM initialization failed — SS animations are DISABLED.\n' +
          '  The SpriteStudio runtime needs WebAssembly SIMD. If you are on RPG Maker MZ /\n' +
          '  NW.js, add this to your game\'s package.json "chromium-args":\n' +
          '    --enable-features=WebAssemblySimd --js-flags=--experimental-wasm-simd\n' +
          '  and use a reasonably recent MZ (bundled Chromium 91+ enables SIMD by default).',
        err,
      );
      _wasmReady = true;
    });

  const Scene_Boot = (globalThis as any).Scene_Boot;
  if (Scene_Boot && !Scene_Boot.prototype.__ssBootGate) {
    Scene_Boot.prototype.__ssBootGate = true;
    const _isReady = Scene_Boot.prototype.isReady;
    Scene_Boot.prototype.isReady = function (this: any): boolean {
      return _isReady.call(this) && _wasmReady;
    };
  }

  return _bootPromise;
}

/** True once the WASM runtime is ready (or has failed and been skipped). */
export function isWasmReady(): boolean {
  return _wasmReady;
}

/** True only when WASM initialized SUCCESSFULLY — gate player construction on this. */
export function isWasmOk(): boolean {
  return _wasmOk;
}
