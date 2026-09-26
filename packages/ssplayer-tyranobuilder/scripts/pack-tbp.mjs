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
// Run after building this package and ssplayer-tyranoscript.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { unzipSync, zipSync } from 'fflate';

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

const outDir = join(pkgRoot, 'dist/pack');
mkdirSync(outDir, { recursive: true });
const tbp = join(outDir, `${PLUGIN_ID}.tbp`);
rmSync(tbp, { force: true });
// Every entry is stamped 1980-01-01 00:00, the earliest time a zip holds, so
// the archive depends on its inputs alone: the same files give the same bytes.
const plugin = Object.fromEntries(files.map(({ name, path }) => [name, readFileSync(path)]));
writeFileSync(tbp, zipSync({ [PLUGIN_ID]: plugin }, { level: 9, mtime: new Date(1980, 0, 1) }));

// The layout is the whole contract with the host, and a wrong one fails at
// install time with a message that points nowhere. Verify it from the artefact.
const listing = Object.keys(unzipSync(readFileSync(tbp)));

const required = `${PLUGIN_ID}/${PLUGIN_ID}.builder.js`;
if (!listing.includes(required)) {
  fail(`the archive has no ${required}; it holds:\n${listing.map((l) => `    ${l}`).join('\n')}`);
}
const stray = listing.filter((entry) => !entry.startsWith(`${PLUGIN_ID}/`));
if (stray.length > 0) {
  fail(`the archive must hold only ${PLUGIN_ID}/, but also has: ${stray.join(', ')}`);
}

console.log(`[pack-tbp] wrote dist/pack/${PLUGIN_ID}.tbp`);
for (const { name } of files) console.log(`           ${PLUGIN_ID}/${name}`);
console.log('');
console.log('Install: TyranoBuilder → plugin settings → add, and pick this file.');
console.log(`Do not rename it: the plugin id comes from the filename (${PLUGIN_ID}).`);
