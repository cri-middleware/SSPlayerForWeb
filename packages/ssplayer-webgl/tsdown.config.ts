import { defineConfig } from 'tsdown';

export default defineConfig([
  // 1. ESM (モジュール向け)
  {
    entry: ['src/index.ts', 'src/lite.ts', 'src/element.ts'],
    format: 'esm',
    dts: true,
    minify: true,
    outputOptions: {
      entryFileNames: '[name].js',
      chunkFileNames: 'chunk-[hash].js',
    },
  },
  // 2. IIFE (ブラウザ直読み向け、全てバンドル)
  {
    entry: ['src/index.ts'],
    format: 'iife',
    globalName: 'SSWebGLPlayer',
    minify: true,
    outDir: 'dist/browser',
    outputOptions: {
      entryFileNames: 'ssplayer-webgl.browser.min.js',
    },
    deps: {
      alwaysBundle: ['@spritestudio/ssplayer-core', 'flatbuffers'],
    }
  }
]);
