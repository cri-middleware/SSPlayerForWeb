// Assemble the distributable RPG Maker MZ plugin bundle for GitHub Releases:
//
//   dist/pack/ssplayer-rmmz-plugin-<version>.zip
//     ├─ ssplayer-rpgmakermz.js             (runtime plugin — build first)
//     └─ ssruntime_bg.wasm                  (runtime WASM)
//
// RPG Maker MZ loads plugins as flat files from js/plugins/, and our plugin
// auto-loads its WASM from the same folder (document.currentScript), so every
// file must sit together in js/plugins/. A user extracts the zip's contents
// straight into js/plugins/ and enables the plugin(s) in the editor.
//
// Run after `pnpm --filter @spritestudio/ssplayer-rmmz run build`. Requires `zip`.
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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

for (const [label, p] of [
  ['ssplayer-rpgmakermz.js', runtimeJs],
  ['ssruntime_bg.wasm', runtimeWasm],
]) {
  if (!existsSync(p)) {
    console.error(`[pack] missing ${label}: ${p}\n  → build first: pnpm --filter @spritestudio/ssplayer-rmmz run build`);
    process.exit(1);
  }
}

try {
  execFileSync('zip', ['--version'], { stdio: 'ignore' });
} catch {
  console.error('[pack] `zip` is required on PATH.');
  process.exit(1);
}

const outDir = join(pkgRoot, 'dist/pack');
const stage = join(outDir, 'stage');
rmSync(stage, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });

copyFileSync(runtimeJs, join(stage, 'ssplayer-rpgmakermz.js'));
copyFileSync(runtimeWasm, join(stage, 'ssruntime_bg.wasm'));

const zipName = `ssplayer-rmmz-plugin-${version}.zip`;
const zipPath = join(outDir, zipName);
rmSync(zipPath, { force: true });
// Zip the stage contents flat (no wrapper dir) — they drop into js/plugins/.
execFileSync('zip', ['-r', '-q', '-j', zipPath, stage], { cwd: stage });
rmSync(stage, { recursive: true, force: true });

console.log(`[pack] wrote dist/pack/${zipName}`);
console.log(`[pack] runtime: ssplayer-rpgmakermz.js + ssruntime_bg.wasm`);
console.log('[pack] extract into js/plugins/ and enable in the MZ plugin manager.');
