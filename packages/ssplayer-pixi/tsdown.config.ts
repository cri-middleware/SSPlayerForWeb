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
    // pixi.js をバンドルせず、ブラウザのグローバル変数 PIXI に依存させる
    deps: {
      alwaysBundle: ['@spritestudio/ssplayer-core', '@spritestudio/ssplayer-core/audio', 'flatbuffers'],
      neverBundle: ['pixi.js']
    }
  }
]);
