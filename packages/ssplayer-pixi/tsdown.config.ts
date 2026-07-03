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
    globalName: 'SSPlayer',
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
      alwaysBundle: ['@spritestudio/ssplayer-core', 'flatbuffers'],
      neverBundle: ['pixi.js']
    }
  }
]);
