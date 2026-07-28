import { defineConfig } from 'tsdown';

// One artefact: `dist/ssplayer.builder.js`.
//
// TyranoBuilder loads a plugin with a dynamic `import()` of
// `<project>/data/others/plugin/<id>/<id>.builder.js` (see the shipped
// `js/app/core/plugin.js`), so the file must be a real ES module exporting
// `plugin_setting` — no IIFE/UMD needed. There is no module resolution for bare
// specifiers though, so `@spritestudio/ssconverter-core` (and the wasm-bindgen
// glue it imports) is inlined.
//
// Only `ssconverter_bg.wasm` stays external. Inlining the glue means this
// bundle is pinned to the exact wasm binary it was built against (a mismatch is
// a `LinkError` at instantiation) — `scripts/install-poc.mjs` always copies the
// two together for that reason.
//
// Not minified: the plugin is read (and debugged) from inside a user's project
// folder, where a readable stack trace is worth far more than bytes.
export default defineConfig({
  entry: ['src/plugin.builder.ts'],
  format: 'esm',
  dts: false,
  minify: false,
  outputOptions: {
    entryFileNames: 'ssplayer.builder.js',
    chunkFileNames: '[name].js',
  },
  deps: {
    alwaysBundle: ['@spritestudio/ssconverter-core'],
  },
});
