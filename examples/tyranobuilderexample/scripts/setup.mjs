// Make this folder a TyranoBuilder project you can open, and list it in the
// builder.
//
//   node scripts/setup.mjs <template>      # first time: a project the builder made
//   node scripts/setup.mjs                 # again later: refresh the plugin
//
// Options: --builder <dir> (default ~/TyranoBuilder).
//
// Only what this example authors is committed (see .gitignore), so a checkout
// is not yet a project. This script:
//
//   1. copies the rest — the engine and the builder's template — from <template>,
//      any project the builder created (a name under <builder>/myproject, or a
//      path). The builder is a commercial product, so its template is never
//      committed here; a new project made from its own menu is where it comes
//      from. Files already here are kept.
//   2. installs the built plugin and the SpriteStudio source of Ringo, through
//      the plugin's own install script. Opening the project converts it.
//   3. links <builder>/myproject/tyranobuilderexample to this folder, so the
//      builder lists it and saves straight into the checkout.
import { cpSync, existsSync, lstatSync, realpathSync, symlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const exampleRoot = resolve(here, '..');
const repoRoot = resolve(exampleRoot, '../..');
const PROJECT_NAME = basename(exampleRoot);
const SAMPLE = 'Ringo';

// What the copy from the template leaves alone: this example's own files, and
// what the plugin installs or writes (a template that already ran the plugin
// carries its state, which belongs to that project).
const KEEP = new Set(['builder_config.json', join('data', 'scenario', 'scene1.ks')]);
const PLUGIN_STATE = [
  join('data', 'others', 'plugin', 'ssplayer'),
  join('data', 'others', 'ssdata'),
  'SpriteStudio_Source',
  '.ss_tools',
  '.ss_import_state.json',
  'ss_import_log.txt',
];

function fail(message) {
  console.error(`[setup] ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const opts = { template: '', builder: join(homedir(), 'TyranoBuilder') };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--builder') opts.builder = argv[++i] ?? '';
    else if (arg.startsWith('-')) fail(`unknown option: ${arg}`);
    else if (!opts.template) opts.template = arg;
    else fail(`unexpected argument: ${arg}`);
  }
  return opts;
}

/** A TyranoBuilder project always has a `data/` folder with the scenario tree. */
function isProject(dir) {
  return existsSync(join(dir, 'data', 'scenario'));
}

function resolveTemplate(opts) {
  const byName = join(opts.builder, 'myproject', opts.template);
  const dir = isProject(byName) ? byName : resolve(opts.template);
  if (!isProject(dir)) fail(`not a TyranoBuilder project (no data/scenario): ${dir}`);
  if (realpathSync(dir) === realpathSync(exampleRoot)) {
    fail('the template has to be another project, not this one');
  }
  return dir;
}

function copyTemplate(template) {
  cpSync(template, exampleRoot, {
    recursive: true,
    force: false,
    filter: (src) => {
      const rel = relative(template, src);
      if (KEEP.has(rel)) return false;
      return !PLUGIN_STATE.some((p) => rel === p || rel.startsWith(p + sep));
    },
  });
  console.log(`[setup] template: ${template}`);
}

function linkIntoBuilder(builder) {
  const projects = join(builder, 'myproject');
  if (!existsSync(projects)) {
    fail(`no TyranoBuilder projects folder at ${projects}.\n  Pass the builder's folder: --builder <dir>`);
  }
  const link = join(projects, PROJECT_NAME);
  let stat = null;
  try {
    stat = lstatSync(link);
  } catch {
    // Nothing there yet.
  }
  if (stat) {
    if (stat.isSymbolicLink() && isProject(link) && realpathSync(link) === realpathSync(exampleRoot)) {
      console.log(`[setup] linked: ${link}`);
      return;
    }
    fail(
      `${link} already exists and is not a link to this example.\n` +
        '  Rename or remove it in the builder (it may be the project you made as the template), then run this again.',
    );
  }
  // A junction on Windows, which needs no administrator rights; the type is
  // ignored elsewhere.
  symlinkSync(exampleRoot, link, 'junction');
  console.log(`[setup] linked: ${link} -> ${exampleRoot}`);
}

const opts = parseArgs(process.argv.slice(2));

const hasTemplate = existsSync(join(exampleRoot, 'tyrano')) && existsSync(join(exampleRoot, 'index.html'));
if (opts.template) copyTemplate(resolveTemplate(opts));
else if (!hasTemplate) {
  fail(
    'this folder has no engine yet.\n' +
      '  Create a new project in TyranoBuilder (any name), then pass it:\n' +
      '    pnpm --filter tyranobuilderexample run setup <that project>',
  );
}

const install = spawnSync(
  process.execPath,
  [
    join(repoRoot, 'packages', 'ssplayer-tyranobuilder', 'scripts', 'install.mjs'),
    exampleRoot,
    '--builder',
    opts.builder,
    '--sample',
    SAMPLE,
  ],
  { stdio: ['ignore', 'ignore', 'inherit'] },
);
if (install.status !== 0) process.exit(install.status ?? 1);
console.log(`[setup] plugin and ${SAMPLE} installed`);

linkIntoBuilder(opts.builder);

console.log('');
console.log(`Next: open "${PROJECT_NAME}" in TyranoBuilder (reopen the builder if it is running).`);
console.log(`  The first open converts ${SAMPLE}; press ▶ on scene1.ks to play the scene.`);
