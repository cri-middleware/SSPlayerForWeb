import { defineConfig } from 'vite';

// The harness imports the workspace package's built dist and the core WASM from
// packages/*, which live above this folder — allow vite's dev server to serve
// them.
export default defineConfig({
  server: { fs: { allow: ['../..'] } },
});
