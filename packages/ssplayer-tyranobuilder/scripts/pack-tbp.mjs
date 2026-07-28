// Build the installable plugin archive:
//
//   dist/pack/ssplayer.tbp
//     └─ ssplayer/
//          ssplayer.builder.js   editor half — components + auto-importer
//          ssconverter_bg.wasm   .sspj → .ssab
//          main.js               runtime half — registers the [ss_*] tags
//          ssruntime_bg.wasm     rendering
//          init.ks               loads main.js at game boot
//          ja.json               component labels
//
// A `.tbp` is a plain zip. The builder's plugin dialog extracts it straight into
// `<project>/data/others/plugin/`, then reads `<id>/<id>.builder.js` — where the
// id is **the .tbp filename without its extension** (`addPlugin()` in
// `js/app/window/window.js`).
//
// So the archive must hold exactly one top-level folder, and the file must keep
// the matching name. Rename `ssplayer.tbp` to `ssplayer-1.2.0.tbp` and the
// install silently looks for `ssplayer-1.2.0/ssplayer-1.2.0.builder.js`, which
// is not there. The version therefore belongs in the release, not the filename.
//
// Run after building this package and ssplayer-tyrano. Requires `zip` on PATH.
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  PLUGIN_ID,
  langFiles,
  pluginFiles,
  requireAll,
  verifyBundle,
} from './pluginFiles.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(here, '..');
const repoRoot = resolve(pkgRoot, '../..');

function fail(message) {
  console.error(`[pack-tbp] ${message}`);
  process.exit(1);
}

const files = [...pluginFiles(repoRoot, pkgRoot), ...langFiles(pkgRoot)];
requireAll(files, fail);
await verifyBundle(files[0].path, fail);

try {
  execFileSync('zip', ['--version'], { stdio: 'ignore' });
} catch {
  fail('`zip` is required on PATH.');
}

const outDir = join(pkgRoot, 'dist/pack');
const stage = join(outDir, 'stage');
const pluginDir = join(stage, PLUGIN_ID);
rmSync(stage, { recursive: true, force: true });
mkdirSync(pluginDir, { recursive: true });

for (const { name, path } of files) copyFileSync(path, join(pluginDir, name));

const tbp = join(outDir, `${PLUGIN_ID}.tbp`);
rmSync(tbp, { force: true });
// Zip from the stage dir so the archive root is `<PLUGIN_ID>/`.
execFileSync('zip', ['-r', '-q', tbp, PLUGIN_ID], { cwd: stage });

// The layout is the whole contract with the host, and a wrong one fails at
// install time with a message that points nowhere. Verify it from the artefact.
const listing = execFileSync('zip', ['-sf', tbp], { encoding: 'utf8' })
  .split('\n')
  .map((line) => line.trim())
  .filter((line) => line && !line.endsWith(':') && !line.startsWith('Total'));

const required = `${PLUGIN_ID}/${PLUGIN_ID}.builder.js`;
if (!listing.includes(required)) {
  fail(`the archive has no ${required}; it holds:\n${listing.map((l) => `    ${l}`).join('\n')}`);
}
const stray = listing.filter((entry) => !entry.startsWith(`${PLUGIN_ID}/`));
if (stray.length > 0) {
  fail(`the archive must hold only ${PLUGIN_ID}/, but also has: ${stray.join(', ')}`);
}

rmSync(stage, { recursive: true, force: true });

console.log(`[pack-tbp] wrote dist/pack/${PLUGIN_ID}.tbp`);
for (const { name } of files) console.log(`           ${PLUGIN_ID}/${name}`);
console.log('');
console.log('Install: TyranoBuilder → plugin settings → add, and pick this file.');
console.log(`Do not rename it: the plugin id comes from the filename (${PLUGIN_ID}).`);
