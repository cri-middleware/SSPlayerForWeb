// Assemble the distributable RPG Maker MZ plugin bundle for GitHub Releases:
//
//   dist/pack/ssplayer-rmmz-plugin-<version>.zip
//     ├─ ssplayer-rpgmakermz.js             (runtime plugin — build first)
//     ├─ ssruntime_bg.wasm                  (runtime WASM)
//     └─ ssconverter_bg.wasm                (converter WASM — .sspj on test play)
//
// RPG Maker MZ loads plugins as flat files from js/plugins/, and our plugin
// auto-loads its WASM from the same folder (document.currentScript), so every
// file must sit together in js/plugins/. A user extracts the zip's contents
// straight into js/plugins/ and enables the plugin(s) in the editor. The
// converter is optional: without it the plugin plays .ssab and converts
// nothing, so an author who converts by hand can leave it out.
//
// Run after `pnpm --filter @spritestudio/ssplayer-rmmz run build`.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { zipSync } from 'fflate';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(here, '..');
const repoRoot = resolve(pkgRoot, '../..');
const version = require(join(pkgRoot, 'package.json')).version;

// Required (runtime) inputs.
const runtimeJs = join(pkgRoot, 'dist/browser/ssplayer-rpgmakermz.js');
// RPG Maker MZ runs on NW.js, whose bundled Chromium predates stable WASM
// simd128 and cannot load the SIMD runtime build. Ship the no-SIMD variant
// (same wasm-bindgen interface, so the bundled glue loads it unchanged).
const runtimeWasm = join(repoRoot, 'packages/ssplayer-core/wasm-nosimd/ssruntime_bg.wasm');
// The converter is built without SIMD in every variant, so the one the other
// packages use loads in MZ's NW.js as it is. Its glue is inlined into the
// plugin, which pins the plugin to this exact binary.
const converterWasm = join(repoRoot, 'packages/ssconverter-core/wasm/ssconverter_bg.wasm');

for (const [label, p] of [
  ['ssplayer-rpgmakermz.js', runtimeJs],
  ['ssruntime_bg.wasm', runtimeWasm],
  ['ssconverter_bg.wasm', converterWasm],
]) {
  if (!existsSync(p)) {
    console.error(`[pack] missing ${label}: ${p}\n  → build first: pnpm --filter @spritestudio/ssplayer-rmmz run build`);
    process.exit(1);
  }
}

const outDir = join(pkgRoot, 'dist/pack');
mkdirSync(outDir, { recursive: true });
const zipName = `ssplayer-rmmz-plugin-${version}.zip`;
const zipPath = join(outDir, zipName);
rmSync(zipPath, { force: true });
// Flat, with no wrapper folder: the files drop straight into js/plugins/.
// Every entry is stamped 1980-01-01 00:00, the earliest time a zip holds, so
// the archive depends on its inputs alone: the same files give the same bytes.
const files = {
  'ssplayer-rpgmakermz.js': readFileSync(runtimeJs),
  'ssruntime_bg.wasm': readFileSync(runtimeWasm),
  'ssconverter_bg.wasm': readFileSync(converterWasm),
};
writeFileSync(zipPath, zipSync(files, { level: 9, mtime: new Date(1980, 0, 1) }));

console.log(`[pack] wrote dist/pack/${zipName}`);
console.log(`[pack] runtime: ssplayer-rpgmakermz.js + ssruntime_bg.wasm, converter: ssconverter_bg.wasm`);
console.log('[pack] extract into js/plugins/ and enable in the MZ plugin manager.');
