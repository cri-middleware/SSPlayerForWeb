import { defineConfig } from 'tsdown';

// ssplayer-tyranoscript ships two artefacts:
//
//  1. ESM `dist/index.js` — for bundler consumers / tests. Exposes
//     `registerSSTags()` and types; does NOT self-register (importing it in a
//     non-Tyrano context must be a no-op).
//
//  2. IIFE `dist/browser/main.js` — the file you drop into a TyranoScript
//     project at `data/others/plugin/ssplayer/main.js`. It bundles the WebGL
//     renderer + core JS glue and, on load, registers the `[ss_*]` custom tags
//     onto `TYRANO.kag.ftag.master_tag` (see src/plugin.ts). The WASM binary is
//     kept EXTERNAL — ship `ssruntime_bg.wasm` alongside and point `[ss_init
//     wasm=...]` at it (TyranoScript has no module resolution).
export default defineConfig([
  // 1. Bundler / test entry (ESM, no minify).
  {
    entry: ['src/index.ts'],
    format: 'esm',
    dts: true,
    outputOptions: {
      entryFileNames: '[name].js',
      chunkFileNames: '[name].js',
    },
  },
  // 2. Browser drop-in plugin (IIFE, self-registering, minified).
  {
    entry: ['src/plugin.ts'],
    format: 'iife',
    globalName: 'SSPlayerTyranoScript',
    minify: true,
    outDir: 'dist/browser',
    outputOptions: {
      entryFileNames: 'main.js',
    },
    // Tyrano can't resolve bare imports at runtime, so everything the plugin
    // needs must be inlined into main.js. Only the WASM binary stays external.
    deps: {
      alwaysBundle: [
        '@spritestudio/ssplayer-tyranoscript',
        '@spritestudio/ssplayer-webgl',
        '@spritestudio/ssplayer-core',
        'flatbuffers',
      ],
    },
  },
]);
