import { defineConfig } from 'tsdown';

// The conversion Worker, built first and then inlined as a string into the
// `./worker-source` entry by `tsdown.config.ts` — see `src/virtual.d.ts` for
// why it is a string rather than a file. Kept in its own config because that
// inlining reads the finished artefact, so the two builds have to be ordered,
// and `pnpm build` runs them in sequence.
//
// `iife`, not `esm`: a host starts this from a Blob URL, and a module Worker
// would resolve its imports against `blob:` and find nothing.
//
// This is the build that cleans `dist/`; the build that follows must not, or it
// would delete this on its way past.
export default defineConfig({
  entry: ['src/converterWorker.ts'],
  format: 'iife',
  dts: false,
  minify: true,
  clean: true,
  outputOptions: {
    entryFileNames: 'converter.worker.js',
  },
  deps: {
    alwaysBundle: ['@spritestudio/ssconverter-core'],
  },
  // The converter glue carries a `new URL('ssconverter_bg.wasm', import.meta.url)`
  // for the case where a caller lets it locate its own wasm. The importer never
  // does — the host reads the bytes and passes them in, because a Worker has no
  // filesystem — so the branch is dead code here, and this says so rather than
  // leaving a warning on every build.
  define: { 'import.meta': '{}' },
});
