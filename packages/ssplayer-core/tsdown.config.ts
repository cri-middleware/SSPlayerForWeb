import { defineConfig } from 'tsdown';

export default defineConfig({
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
