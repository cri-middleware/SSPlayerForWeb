import { defineConfig } from 'tsdown';

// The RPG Maker MZ plugin annotation (/*: and /*:ja) is prepended to each IIFE
// AFTER the bundle is written, by scripts/prepend-annotation.mjs (wired into the
// `build` npm script). tsdown/rolldown's `banner` option does not survive here,
// so the post-build prepend is the reliable path. See spec §9.
//
// ssplayer-rmmz ships two artefacts:
//
//  1. ESM `dist/index.js` — for bundler consumers / vitest. Exposes SSPlayer,
//     SSPlayerRenderer, the RMMZ managers and types; does NOT self-register (safe
//     to import outside RPG Maker MZ). `pixi.js` stays external (peer dep).
//
//  2. IIFE `dist/browser/ssplayer-rpgmakermz.js` — the runtime plugin you drop
//     into `js/plugins/`. Bundles ssplayer-core + flatbuffers, and the test-play
//     importer with the converter glue; `pixi.js` is EXTERNAL (RMMZ provides
//     `window.PIXI` v5). Both WASM binaries are EXTERNAL and sit beside the
//     plugin: `ssruntime_bg.wasm` always, `ssconverter_bg.wasm` to convert
//     `.sspj` on test play (see `src/rmmz/autoImport.ts`).
export default defineConfig([
  // 1. Bundler / test entry (ESM, no minify). pixi.js external.
  {
    entry: ['src/index.ts'],
    format: 'esm',
    dts: true,
    external: ['pixi.js'],
    outputOptions: {
      entryFileNames: '[name].js',
      chunkFileNames: '[name].js',
    },
  },
  // 2. Runtime drop-in plugin (IIFE, self-registering, minified).
  {
    entry: ['src/plugin.ts'],
    format: 'iife',
    globalName: 'SSPlayerRmmz',
    minify: true,
    outDir: 'dist/browser',
    // RMMZ bundles PixiJS v5 as a global; never bundle our own copy.
    external: ['pixi.js'],
    outputOptions: {
      entryFileNames: 'ssplayer-rpgmakermz.js',
      globals: { 'pixi.js': 'PIXI' },
    },
    // Everything the runtime needs must be inlined (MZ has no module resolution).
    // Only the WASM binaries and the host-provided PIXI stay external.
    deps: {
      alwaysBundle: [
        '@spritestudio/ssplayer-rmmz',
        '@spritestudio/ssplayer-webgl',
        '@spritestudio/ssplayer-core',
        'flatbuffers',
        // The importer, and the conversion Worker as a string.
        /^@spritestudio\/ssconverter-importer(\/|$)/,
        '@spritestudio/ssconverter-core',
      ],
    },
    // The converter glue carries a `new URL('ssconverter_bg.wasm',
    // import.meta.url)` for a caller that lets it find its own wasm. The
    // importer always passes the bytes, and a classic script has no
    // `import.meta`, so the branch is dead here and must not reach the IIFE.
    define: { 'import.meta': '{}' },
  },
]);
