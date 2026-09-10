import { defineConfig } from 'tsdown';

export default defineConfig([
  // 1. バンドラー向け（ESM, minifyなし）
  {
    entry: ['src/index.ts'],
    format: 'esm',
    dts: true,
    outputOptions: {
      entryFileNames: '[name].js',
      chunkFileNames: '[name].js',
    },
  },
  // 2. ブラウザ直読み向け（IIFE, minifyあり）
  {
    entry: ['src/index.ts'],
    format: 'iife',
    // Namespace global for classic <script> / CDN use, symmetric with
    // ssplayer-webgl's `SSWebGLPlayer`. The renderer class is `SSPixiPlayer.SSPlayer`.
    globalName: 'SSPixiPlayer',
    minify: true, // Oxc minify
    outDir: 'dist/browser',
    outputOptions: {
      entryFileNames: 'ssplayer-pixi.browser.min.js',
      globals: {
        'pixi.js': 'PIXI'
      }
    },
    // pixi.js をバンドルせず、ブラウザのグローバル変数 PIXI に依存させる。
    //
    // **Every core subpath export is listed in alwaysBundle, not just the
    // package.** An IIFE has no way to resolve a bare specifier at runtime, so
    // anything left external here fails the moment it is reached — and
    // `'@spritestudio/ssplayer-core'` does NOT cover
    // `'@spritestudio/ssplayer-core/audio'`: a subpath is its own specifier.
    // Nothing catches the omission on the way out (the build, the types and the
    // tests all pass, and the ESM entry is correct as it stands); it shows up
    // only in the CDN build, and quietly — the audio adapter's import is awaited
    // inside a try/catch, so sound just stops. After adding a subpath to core's
    // `exports`, check the output:
    //   grep -c 'ssplayer-core/<subpath>' dist/browser/*.js   # must be 0
    //
    // `pixi.js` is the deliberate opposite: it stays external because the page
    // is expected to have loaded PIXI already (see `globals` above).
    deps: {
      alwaysBundle: ['@spritestudio/ssplayer-core', '@spritestudio/ssplayer-core/audio', 'flatbuffers'],
      neverBundle: ['pixi.js']
    }
  }
]);
