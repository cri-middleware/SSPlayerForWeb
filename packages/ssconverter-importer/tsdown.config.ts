import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'tsdown';

// Two entries: the importer (`.`) and the Worker's bundle as a string
// (`./worker-source`). Hosts bundle both into their own plugin — nothing here
// is loaded at run time from this package — so the output stays unminified
// and `@spritestudio/ssconverter-core` stays external, for the host's bundler
// to inline next to the rest.
//
// The Worker is built first, by `tsdown.worker.config.ts`, and read back in
// here as `virtual:converter-worker`: the string and the importer that starts
// it then always come from one build of the protocol they speak.

const here = dirname(fileURLToPath(import.meta.url));
const WORKER_MODULE = 'virtual:converter-worker';
const WORKER_BUNDLE = join(here, 'dist/converter.worker.js');

/** Serves the built Worker to `src/workerSource.ts` as a string. */
const inlineWorker = {
  name: 'inline-converter-worker',
  resolveId(id: string) {
    return id === WORKER_MODULE ? `\0${WORKER_MODULE}` : null;
  },
  load(id: string) {
    if (id !== `\0${WORKER_MODULE}`) return null;
    let source: string;
    try {
      source = readFileSync(WORKER_BUNDLE, 'utf8');
    } catch {
      throw new Error(
        `${WORKER_BUNDLE} is missing — build it first: tsdown --config tsdown.worker.config.ts ` +
          '(`pnpm build` runs both in order).',
      );
    }
    return `export default ${JSON.stringify(source)};`;
  },
};

export default defineConfig({
  entry: ['src/index.ts', 'src/workerSource.ts'],
  format: 'esm',
  dts: true,
  // `tsdown.worker.config.ts` already cleaned, and its output is this build's
  // input.
  clean: false,
  plugins: [inlineWorker],
  outputOptions: {
    entryFileNames: '[name].js',
    chunkFileNames: '[name].js',
  },
});
