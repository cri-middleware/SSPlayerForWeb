import { defineConfig } from 'tsdown';

export default defineConfig({
  // One entry per subpath the package exports. `audio.ts` is separate so that
  // importing the index never drags the Web Audio adapter in — a build with no
  // sound pays nothing for it, and ssplayer-webgl reaches it through a dynamic
  // `import()` that keeps its `./lite` build audio-free.
  //
  // **Adding an entry here is three edits, not one.** The `exports` map in
  // package.json, this list, and `deps.alwaysBundle` in the IIFE builds of every
  // package that consumes it — ssplayer-webgl (two of them) and ssplayer-pixi.
  // A subpath is its own specifier, so listing the bare package there does not
  // cover it, and a subpath left external ends up in the browser bundles as a
  // bare `import()` that cannot resolve at runtime. Nothing fails on the way
  // out: the build, the types, the tests and the ESM entries are all fine, and
  // only the CDN builds break. See the note beside either `alwaysBundle`.
  entry: ['src/index.ts', 'src/audio.ts'],
  format: 'esm',
  dts: true,
  alias: {
    flatbuffers: 'flatbuffers/mjs/flatbuffers.js',
  },
  outputOptions: {
    entryFileNames: '[name].js',
    chunkFileNames: '[name].js',
  },
});
