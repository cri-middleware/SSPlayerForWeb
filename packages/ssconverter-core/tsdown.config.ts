import { defineConfig } from 'tsdown';

// Keep the wasm-bindgen glue external so dist imports it from ../wasm at
// runtime. The glue is tightly coupled to its exact wasm binary; bundling a
// copy into dist lets the two desync when `download:wasm`/`build:wasm` refresh
// wasm/ without a core rebuild (LinkError at instantiation). Leaving it
// external makes wasm/ the single matched source of truth.
const wasmGlue = [/wasm\/ssconverter\.js$/];

export default defineConfig({
  entry: ['src/index.ts'],
  format: 'esm',
  dts: true,
  deps: {
    neverBundle: wasmGlue,
    dts: { neverBundle: wasmGlue },
  },
  outputOptions: {
    entryFileNames: '[name].js',
    chunkFileNames: '[name].js',
  },
});
