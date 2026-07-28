// Assemble the distributable TyranoScript plugin bundle for GitHub Releases:
//
//   dist/pack/ssplayer-tyranoscript-plugin-<version>.zip
//     └─ ssplayer/
//          init.ks              (from plugin/init.ks)
//          main.js              (from dist/browser/main.js — build first)
//          ssruntime_bg.wasm    (from @spritestudio/ssplayer-core)
//
// A user drops the `ssplayer/` folder into `data/others/plugin/`. Run after
// `pnpm --filter @spritestudio/ssplayer-tyranoscript run build`. Requires `zip`.
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

const mainJs = join(pkgRoot, 'dist/browser/main.js');
const wasm = join(repoRoot, 'packages/ssplayer-core/dist/ssruntime_bg.wasm');
const initKs = join(pkgRoot, 'plugin/init.ks');

for (const [label, p] of [['main.js', mainJs], ['ssruntime_bg.wasm', wasm], ['init.ks', initKs]]) {
  if (!existsSync(p)) {
    console.error(`[pack] missing ${label}: ${p}\n  → build first: pnpm --filter @spritestudio/ssplayer-tyranoscript run build`);
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
const pluginDir = join(stage, 'ssplayer');
rmSync(stage, { recursive: true, force: true });
mkdirSync(pluginDir, { recursive: true });

copyFileSync(initKs, join(pluginDir, 'init.ks'));
copyFileSync(mainJs, join(pluginDir, 'main.js'));
copyFileSync(wasm, join(pluginDir, 'ssruntime_bg.wasm'));

const zipName = `ssplayer-tyranoscript-plugin-${version}.zip`;
const zipPath = join(outDir, zipName);
rmSync(zipPath, { force: true });
// Zip from the stage dir so the archive root is `ssplayer/`.
execFileSync('zip', ['-r', '-q', zipPath, 'ssplayer'], { cwd: stage });
rmSync(stage, { recursive: true, force: true });

console.log(`[pack] wrote dist/pack/${zipName}`);
console.log('[pack] attach this to a GitHub Release; users extract `ssplayer/` into data/others/plugin/.');
