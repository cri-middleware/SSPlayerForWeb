// Assemble the distributable TyranoScript plugin bundle for GitHub Releases:
//
//   dist/pack/ssplayer-tyranoscript-plugin-<version>.zip
//     └─ ssplayer/
//          init.ks              (from plugin/init.ks)
//          main.js              (from dist/browser/main.js — build first)
//          ssruntime_bg.wasm    (from @spritestudio/ssplayer-core)
//          readme.txt           (from plugin/readme.txt, {{VERSION}} filled in)
//
// A user drops the `ssplayer/` folder into `data/others/plugin/`. Run after
// `pnpm --filter @spritestudio/ssplayer-tyranoscript run build`.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { strToU8, zipSync } from 'fflate';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(here, '..');
const repoRoot = resolve(pkgRoot, '../..');
const version = require(join(pkgRoot, 'package.json')).version;

const mainJs = join(pkgRoot, 'dist/browser/main.js');
const wasm = join(repoRoot, 'packages/ssplayer-core/dist/ssruntime_bg.wasm');
const initKs = join(pkgRoot, 'plugin/init.ks');
const readmeTxt = join(pkgRoot, 'plugin/readme.txt');

for (const [label, p] of [
  ['main.js', mainJs],
  ['ssruntime_bg.wasm', wasm],
  ['init.ks', initKs],
  ['readme.txt', readmeTxt],
]) {
  if (!existsSync(p)) {
    console.error(`[pack] missing ${label}: ${p}\n  → build first: pnpm --filter @spritestudio/ssplayer-tyranoscript run build`);
    process.exit(1);
  }
}

// The plugin library (plugin.tyrano.jp) and TyranoScript's own plugin guide both
// expect a readme in the folder. Keep the version out of the committed template
// so a release bump can't leave a stale number in the shipped file.
const readme = readFileSync(readmeTxt, 'utf8');
if (!readme.includes('{{VERSION}}')) {
  console.error('[pack] plugin/readme.txt no longer contains the {{VERSION}} placeholder.');
  process.exit(1);
}

const outDir = join(pkgRoot, 'dist/pack');
mkdirSync(outDir, { recursive: true });
const zipName = `ssplayer-tyranoscript-plugin-${version}.zip`;
const zipPath = join(outDir, zipName);
rmSync(zipPath, { force: true });
// The archive root is `ssplayer/`, the folder a user drops into place.
// Every entry is stamped 1980-01-01 00:00, the earliest time a zip holds, so
// the archive depends on its inputs alone: the same files give the same bytes.
const plugin = {
  'init.ks': readFileSync(initKs),
  'main.js': readFileSync(mainJs),
  'ssruntime_bg.wasm': readFileSync(wasm),
  'readme.txt': strToU8(readme.replaceAll('{{VERSION}}', version)),
};
writeFileSync(zipPath, zipSync({ ssplayer: plugin }, { level: 9, mtime: new Date(1980, 0, 1) }));

console.log(`[pack] wrote dist/pack/${zipName}`);
console.log('[pack] attach this to a GitHub Release; users extract `ssplayer/` into data/others/plugin/.');
