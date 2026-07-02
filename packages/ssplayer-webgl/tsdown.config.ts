import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['src/index.ts', 'src/lite.ts', 'src/element.ts'],
  format: 'esm',
  dts: true,
  // Minify the whole webgl output (entries + shared renderer chunk). Safe here:
  // `@spritestudio/ssplayer-core` is external (untouched — its cross-package minify
  // is deferred to final polish), and only end consumers load webgl's dist. The
  // `element` entry benefits most (it drops onto a page as-is). Default minify keeps
  // class member names (no property mangling), so the Custom Element lifecycle
  // callbacks and the GLSL attribute-name string literals are preserved.
  minify: true,
  outputOptions: {
    entryFileNames: '[name].js',
    chunkFileNames: 'chunk-[hash].js',
  },
});
