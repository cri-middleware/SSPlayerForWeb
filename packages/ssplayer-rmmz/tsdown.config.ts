import { defineConfig } from 'tsdown';

// The RPG Maker MZ plugin annotation (/*: and /*:ja) is prepended to each IIFE
// AFTER the bundle is written, by scripts/prepend-annotation.mjs (wired into the
// `build` npm script). tsdown/rolldown's `banner` option does not survive here,
// so the post-build prepend is the reliable path. See spec §9.
//
// ssplayer-rmmz ships three artefacts:
//
//  1. ESM `dist/index.js` — for bundler consumers / vitest. Exposes SSPlayer,
//     SSPlayerRenderer, the RMMZ managers and types; does NOT self-register (safe
//     to import outside RPG Maker MZ). `pixi.js` stays external (peer dep).
//
//  2. IIFE `dist/browser/ssplayer-rpgmakermz.js` — the runtime plugin you drop
//     into `js/plugins/`. Bundles ssplayer-core + flatbuffers; `pixi.js` is
//     EXTERNAL (RMMZ provides `window.PIXI` v5). The WASM binary is EXTERNAL —
//     ship `ssruntime_bg.wasm` alongside and point the `wasmPath` param at it.
//
//  3. IIFE `dist/browser/ssplayer-rpgmakermz-devconvert.js` — an OPTIONAL,
//     developer-only plugin that (under NW.js test-play) converts `.sspj`
//     projects dropped in `ss_source/` to `.ssab` via ssconverter-core. Never
//     add it to a deployed game. Bundles ssconverter-core glue; its wasm and
//     pixi stay external.
export default defineConfig([
  // 1. Bundler / test entry (ESM, no minify). pixi.js + converter external.
  {
    entry: ['src/index.ts'],
    format: 'esm',
    dts: true,
    external: ['pixi.js', '@spritestudio/ssconverter-core'],
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
    // Only the WASM binary and the host-provided PIXI stay external.
    deps: {
      alwaysBundle: [
        '@spritestudio/ssplayer-rmmz',
        '@spritestudio/ssplayer-webgl',
        '@spritestudio/ssplayer-core',
        'flatbuffers',
      ],
    },
  },
  // 3. Developer-only converter plugin (IIFE, NW.js test-play only).
  {
    entry: ['src/devconvert.ts'],
    format: 'iife',
    globalName: 'SSPlayerRmmzDevConvert',
    minify: true,
    outDir: 'dist/browser',
    external: ['pixi.js'],
    outputOptions: {
      entryFileNames: 'ssplayer-rpgmakermz-devconvert.js',
      globals: { 'pixi.js': 'PIXI' },
    },
    deps: {
      alwaysBundle: [
        '@spritestudio/ssplayer-rmmz',
        '@spritestudio/ssconverter-core',
        'flatbuffers',
      ],
    },
  },
]);
