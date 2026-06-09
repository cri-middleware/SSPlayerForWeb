import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['src/index.ts'],
  format: 'esm',
  dts: true,
  outputOptions: {
    entryFileNames: '[name].js',
    chunkFileNames: '[name].js',
  },
});
