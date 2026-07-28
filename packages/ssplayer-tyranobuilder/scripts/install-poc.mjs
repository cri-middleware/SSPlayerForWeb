// Install the built plugin into a TyranoBuilder project so it can be tried in
// the real editor.
//
//   node scripts/install-poc.mjs --project <path-to-project> [--sample [name]]
//   node scripts/install-poc.mjs --builder ~/TyranoBuilder --sample
//
// With no --project, the single project under <builder>/myproject is used.
// `--sample` also copies a SpriteStudio project out of the SpriteStudio-SDK
// submodule into <project>/SpriteStudio_Source/, so there is something to
// convert on the first run.
//
// The bundle and the wasm are always copied as a pair: the wasm-bindgen glue is
// inlined into the bundle, so a mismatched pair is a LinkError at instantiation.
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(here, '..');
const repoRoot = resolve(pkgRoot, '../..');

const PLUGIN_ID = 'ssplayer';
const DEFAULT_SAMPLE = 'Ringo';

function parseArgs(argv) {
  const opts = { project: '', builder: join(homedir(), 'TyranoBuilder'), sample: '' };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--project') opts.project = argv[++i] ?? '';
    else if (arg === '--builder') opts.builder = argv[++i] ?? '';
    else if (arg === '--sample') {
      const next = argv[i + 1];
      opts.sample = next && !next.startsWith('--') ? argv[++i] : DEFAULT_SAMPLE;
    } else {
      fail(`unknown argument: ${arg}`);
    }
  }
  return opts;
}

function fail(message) {
  console.error(`[install-poc] ${message}`);
  process.exit(1);
}

/** A TyranoBuilder project always has a `data/` folder with the scenario tree. */
function isProject(dir) {
  return existsSync(join(dir, 'data', 'scenario'));
}

function resolveProject(opts) {
  if (opts.project) {
    const dir = resolve(opts.project);
    if (!isProject(dir)) {
      fail(`not a TyranoBuilder project (no data/scenario): ${dir}`);
    }
    return dir;
  }

  const projectsDir = join(opts.builder, 'myproject');
  if (!existsSync(projectsDir)) {
    fail(`no projects directory at ${projectsDir} — pass --project <path> instead.`);
  }
  const candidates = readdirSync(projectsDir)
    .map((name) => join(projectsDir, name))
    .filter((dir) => statSync(dir).isDirectory() && isProject(dir));

  if (candidates.length === 0) {
    fail(
      `no projects found under ${projectsDir}.\n` +
        '  Create one in TyranoBuilder first (it is the folder holding data/scenario).',
    );
  }
  if (candidates.length > 1) {
    fail(
      `found ${candidates.length} projects under ${projectsDir}; pass --project <path>:\n` +
        candidates.map((c) => `    ${c}`).join('\n'),
    );
  }
  return candidates[0];
}

const opts = parseArgs(process.argv.slice(2));
const project = resolveProject(opts);

const bundle = join(pkgRoot, 'dist', 'ssplayer.builder.js');
const wasm = join(repoRoot, 'packages/ssconverter-core/wasm/ssconverter_bg.wasm');

for (const [label, path] of [
  ['dist/ssplayer.builder.js', bundle],
  ['ssconverter_bg.wasm', wasm],
]) {
  if (!existsSync(path)) {
    fail(
      `missing ${label}: ${path}\n` +
        '  → build first: pnpm --filter @spritestudio/ssplayer-tyranobuilder run build\n' +
        '    (and `pnpm download:wasm` from the repo root if the wasm is absent)',
    );
  }
}

const pluginDir = join(project, 'data', 'others', 'plugin', PLUGIN_ID);
mkdirSync(pluginDir, { recursive: true });
copyFileSync(bundle, join(pluginDir, `${PLUGIN_ID}.builder.js`));
copyFileSync(wasm, join(pluginDir, 'ssconverter_bg.wasm'));

console.log(`[install-poc] project: ${project}`);
console.log(`[install-poc] installed ${PLUGIN_ID}.builder.js + ssconverter_bg.wasm -> ${pluginDir}`);

if (opts.sample) {
  const src = join(repoRoot, 'SpriteStudio-SDK/tests', opts.sample);
  if (!existsSync(src)) {
    fail(
      `sample project not found: ${src}\n` +
        '  → the SpriteStudio-SDK submodule may not be checked out (git submodule update --init).',
    );
  }
  const dest = join(project, 'SpriteStudio_Source', opts.sample);
  mkdirSync(dirname(dest), { recursive: true });
  cpSync(src, dest, { recursive: true });
  console.log(`[install-poc] sample project -> ${dest}`);
}

console.log('');
console.log('Next: open the project in TyranoBuilder (reopen it if it is already open).');
console.log('  A dialog reports the result; details land in <project>/ss_import_log.txt');
console.log(`  Converted packs appear under ${join(project, 'data/others/ssdata')}`);
