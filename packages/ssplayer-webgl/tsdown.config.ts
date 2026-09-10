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
    // **Every core subpath export is listed, not just the package.** An IIFE has
    // no way to resolve a bare specifier at runtime, so anything left external
    // here fails the moment it is reached — and `'@spritestudio/ssplayer-core'`
    // does NOT cover `'@spritestudio/ssplayer-core/audio'`: a subpath is its own
    // specifier. Nothing catches the omission on the way out (the build, the
    // types and the tests all pass, and the ESM entries are correct as they
    // stand); it shows up only in the CDN builds, and quietly — the audio
    // adapter's import is awaited inside a try/catch, so sound just stops.
    // After adding a subpath to core's `exports`, check the output:
    //   grep -c 'ssplayer-core/<subpath>' dist/browser/*.js   # must be 0
    deps: {
      alwaysBundle: ['@spritestudio/ssplayer-core', '@spritestudio/ssplayer-core/audio', 'flatbuffers'],
    }
  },
  // 3. IIFE — self-registering <ss-player> Custom Element for classic <script> / CDN.
  //    Dropping this one file on a page defines <ss-player> (no JS to call). Each
  //    element needs a `wasm` attribute (no import.meta.url outside a bundler).
  {
    entry: ['src/element.iife.ts'],
    format: 'iife',
    globalName: 'SSWebGLPlayerElement',
    minify: true,
    outDir: 'dist/browser',
    outputOptions: {
      entryFileNames: 'ss-player.element.min.js',
    },
    // Same rule as the bundle above: subpaths are listed one by one.
    deps: {
      alwaysBundle: ['@spritestudio/ssplayer-core', '@spritestudio/ssplayer-core/audio', 'flatbuffers'],
    }
  }
]);
