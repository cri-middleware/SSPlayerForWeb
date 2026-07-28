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
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs';
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

// One plugin folder, two halves. The editor half is this package; the runtime
// half is @spritestudio/ssplayer-tyrano, whose main.js registers the [ss_*] tags
// the components write. Without it a scenario placed in the GUI parses but dies
// at run time with "no such tag" — TyranoBuilder itself never sees a problem,
// because the tags only exist inside the running game.
//
// `init.ks` is what ties them together: its presence makes getPluginTag() emit
// [plugin name="ssplayer"] into data/scenario/system/plugin_third.ks, which
// TyranoScript expands to [call storage="../others/plugin/ssplayer/init.ks"] →
// [loadjs storage="plugin/ssplayer/main.js"].
const FILES = [
  ['ssplayer.builder.js', bundle, 'pnpm --filter @spritestudio/ssplayer-tyranobuilder run build'],
  [
    'ssconverter_bg.wasm',
    join(repoRoot, 'packages/ssconverter-core/wasm/ssconverter_bg.wasm'),
    'pnpm download:wasm',
  ],
  [
    'main.js',
    join(repoRoot, 'packages/ssplayer-tyrano/dist/browser/main.js'),
    'pnpm --filter @spritestudio/ssplayer-tyrano run build',
  ],
  [
    'ssruntime_bg.wasm',
    join(repoRoot, 'packages/ssplayer-core/dist/ssruntime_bg.wasm'),
    'pnpm download:wasm && pnpm --filter @spritestudio/ssplayer-core run build',
  ],
  ['init.ks', join(repoRoot, 'packages/ssplayer-tyrano/plugin/init.ks'), null],
];

for (const [label, path, hint] of FILES) {
  if (!existsSync(path)) {
    fail(`missing ${label}: ${path}${hint ? `\n  → build it first: ${hint}` : ''}`);
  }
}

// The builder resolves nothing: it hands the file straight to `import()`, so a
// surviving bare specifier rejects the import and the plugin silently never
// loads — no error in the UI, no log, just missing components. Catch it here,
// where there is somewhere to print it.
const bundleSource = readFileSync(bundle, 'utf8');
const bareImports = [
  // `import … from "pkg"` / `export … from "pkg"`, and the side-effect `import "pkg"`.
  ...bundleSource.matchAll(/^\s*(?:import|export)[^'"]*from\s*['"]([^.'"][^'"]*)['"]/gm),
  ...bundleSource.matchAll(/^\s*import\s*['"]([^.'"][^'"]*)['"]/gm),
].map((m) => m[1]);
if (bareImports.length > 0) {
  fail(
    `the bundle still imports ${[...new Set(bareImports)].join(', ')}.\n` +
      '  TyranoBuilder cannot resolve bare specifiers — add them to `deps.alwaysBundle` in tsdown.config.ts.',
  );
}

const pluginDir = join(project, 'data', 'others', 'plugin', PLUGIN_ID);
mkdirSync(pluginDir, { recursive: true });
for (const [label, path] of FILES) {
  // The builder finds the editor half by name: <plugin_id>/<plugin_id>.builder.js.
  const dest = label === 'ssplayer.builder.js' ? `${PLUGIN_ID}.builder.js` : label;
  copyFileSync(path, join(pluginDir, dest));
}

// Component labels. The builder merges <plugin>/<lang>.json into its own string
// table before importing the plugin, and `$.s()` falls back to the key, so a
// missing language just leaves the English source strings in place.
const langDir = join(pkgRoot, 'lang');
const langs = existsSync(langDir) ? readdirSync(langDir).filter((f) => f.endsWith('.json')) : [];
for (const file of langs) copyFileSync(join(langDir, file), join(pluginDir, file));

console.log(`[install-poc] project: ${project}`);
console.log(`[install-poc] plugin -> ${pluginDir}`);
for (const [label] of FILES) console.log(`             ${label}`);
for (const file of langs) console.log(`             ${file}`);

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
