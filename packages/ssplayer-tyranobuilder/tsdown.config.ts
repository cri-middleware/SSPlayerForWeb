import { defineConfig } from 'tsdown';

// One shipped artefact: `dist/ssplayer.builder.js`.
//
// TyranoBuilder loads a plugin with a dynamic `import()` of
// `<project>/data/others/plugin/<id>/<id>.builder.js` (see the shipped
// `js/app/core/plugin.js`), so the file must be a real ES module exporting
// `plugin_setting` — no IIFE/UMD needed.
//
// There is no module resolution for bare specifiers though: a surviving
// `import … from "@spritestudio/…"` makes the whole `import()` reject, and the
// plugin silently never loads. Every workspace dependency is therefore inlined,
// and `scripts/install.mjs` refuses to deploy a bundle that still has one.
//
// The conversion Worker is inlined too, as a string — the `./worker-source`
// entry of `@spritestudio/ssconverter-importer`. It could have been a second
// file in the plugin folder, but a string costs less in every direction: the
// folder is under `data/`, which an export copies wholesale into the shipped
// game, and a separate file could go missing or fall out of step with the
// bundle that speaks its protocol. At 6 kB — the wasm is external, so this is
// only the glue — there is nothing to gain by splitting it out.
//
// Only `ssconverter_bg.wasm` stays external. Inlining the glue means this
// bundle is pinned to the exact wasm binary it was built against (a mismatch is
// a `LinkError` at instantiation) — `scripts/install.mjs` always copies the
// two together for that reason.
//
// Minified, reluctantly. This file has to sit in the plugin folder for the
// editor to find it, which is under `data/`, which an export copies wholesale
// into the shipped game — so its size is paid by every player of every game
// built with it. Diagnostics do not depend on reading it: the plugin writes
// `<project>/ss_import_log.txt`, and the sources are in this repo.

export default defineConfig({
  entry: ['src/plugin.builder.ts'],
  format: 'esm',
  dts: false,
  minify: true,
  outputOptions: {
    entryFileNames: 'ssplayer.builder.js',
    chunkFileNames: '[name].js',
  },
  deps: {
    alwaysBundle: [
      // The importer, and the Worker's bundle as a string (`./worker-source`).
      /^@spritestudio\/ssconverter-importer(\/|$)/,
      // Bundled here as well as in the Worker: it is what converts when a
      // builder build turns out not to let the plugin start one.
      '@spritestudio/ssconverter-core',
      // Only for `SSRuntimeManager.extractAnimationNames`, a pure FlatBuffers
      // walk — the runtime wasm and the renderer tree-shake away.
      '@spritestudio/ssplayer-core',
      'flatbuffers',
    ],
  },
});
