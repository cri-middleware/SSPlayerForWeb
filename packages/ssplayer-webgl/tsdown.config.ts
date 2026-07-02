import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['src/index.ts', 'src/lite.ts'],
  format: 'esm',
  dts: true,
  outputOptions: {
    entryFileNames: '[name].js',
    chunkFileNames: 'chunk-[hash].js',
  },
});
