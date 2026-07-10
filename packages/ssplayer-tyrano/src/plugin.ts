// Browser drop-in entry (built to `dist/browser/main.js`).
//
// This is the file you place at `data/others/plugin/ssplayer/main.js` in a
// TyranoScript project. Unlike the ESM `index.ts` entry, it has a side effect:
// on load it registers the `[ss_*]` custom tags onto the running Tyrano
// runtime. It is loaded via `[loadjs storage="plugin/ssplayer/main.js"]` from
// the plugin's `init.ks`, at which point `TYRANO` is already a global.
//
// The whole WebGL renderer + core JS glue is bundled in (Tyrano has no module
// resolution); only `ssruntime_bg.wasm` stays external — ship it alongside and
// point `[ss_init wasm="others/plugin/ssplayer/ssruntime_bg.wasm"]` at it.

import { registerSSTags } from './registerTags.js';

// Re-export so consumers who *do* load this as a module can still call it, and
// so the IIFE global (`SSPlayerTyrano.registerSSTags`) is populated.
export { registerSSTags } from './registerTags.js';

const registered = registerSSTags();
if (registered) {
  console.log('[ssplayer-tyrano] [ss_*] custom tags registered.');
} else {
  // Loaded before the Tyrano runtime existed. Rare (init.ks loads us after
  // boot), but warn rather than fail silently so the cause is discoverable.
  console.warn(
    '[ssplayer-tyrano] TYRANO runtime not found at load time; call SSPlayerTyrano.registerSSTags() once it is ready.',
  );
}
