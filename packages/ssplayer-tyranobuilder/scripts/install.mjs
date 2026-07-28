// Install the built plugin into a TyranoBuilder project.
//
//   node scripts/install.mjs                     # the only project, or list them
//   node scripts/install.mjs mygame              # by name, under <builder>/myproject
//   node scripts/install.mjs ../elsewhere/proj   # by path
//   node scripts/install.mjs mygame --sample     # …and seed a project to convert
//
// Options: --builder <dir> (default ~/TyranoBuilder), --sample [name].
//
// This copies the same files `pack-tbp.mjs` archives, straight into a project —
// the shortcut for developing on the plugin, where going through the editor's
// install dialog on every build would be tedious. Authors install the `.tbp`.
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
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
    } else if (arg.startsWith('-')) {
      fail(`unknown option: ${arg}`);
    } else if (!opts.project) {
      // Positional: a project name or a path, whichever is easier to type.
      opts.project = arg;
    } else {
      fail(`unexpected argument: ${arg}`);
    }
  }
  return opts;
}

function fail(message) {
  console.error(`[install] ${message}`);
  process.exit(1);
}

/** A TyranoBuilder project always has a `data/` folder with the scenario tree. */
function isProject(dir) {
  return existsSync(join(dir, 'data', 'scenario'));
}

/** Every project under the builder's own projects folder. */
function listProjects(builder) {
  const projectsDir = join(builder, 'myproject');
  if (!existsSync(projectsDir)) return [];
  return readdirSync(projectsDir)
    .map((name) => join(projectsDir, name))
    .filter((dir) => statSync(dir).isDirectory() && isProject(dir));
}

function resolveProject(opts) {
  const known = listProjects(opts.builder);

  if (opts.project) {
    // A bare name means one of the builder's own projects; anything with a
    // separator, or a name that matches nothing, is treated as a path.
    const byName = known.find((dir) => basename(dir) === opts.project);
    const dir = byName ?? resolve(opts.project);
    if (!isProject(dir)) {
      fail(
        `not a TyranoBuilder project (no data/scenario): ${dir}` +
          (known.length ? `\n  Projects under ${join(opts.builder, 'myproject')}:\n` +
            known.map((c) => `    ${basename(c)}`).join('\n') : ''),
      );
    }
    return dir;
  }

  if (known.length === 0) {
    fail(
      `no projects found under ${join(opts.builder, 'myproject')}.\n` +
        '  Create one in TyranoBuilder first (it is the folder holding data/scenario),\n' +
        '  or pass a path: node scripts/install.mjs <path-to-project>',
    );
  }
  if (known.length > 1) {
    fail(
      `${known.length} projects found — name the one you want:\n` +
        known.map((c) => `    node scripts/install.mjs ${basename(c)}`).join('\n'),
    );
  }
  return known[0];
}

const opts = parseArgs(process.argv.slice(2));
const project = resolveProject(opts);

const files = [...pluginFiles(repoRoot, pkgRoot), ...langFiles(pkgRoot)];
requireAll(files, fail);
await verifyBundle(files[0].path, fail);

const pluginDir = join(project, 'data', 'others', 'plugin', PLUGIN_ID);
mkdirSync(pluginDir, { recursive: true });
for (const { name, path } of files) copyFileSync(path, join(pluginDir, name));

console.log(`[install] project: ${project}`);
console.log(`[install] plugin -> ${pluginDir}`);
for (const { name } of files) console.log(`             ${name}`);

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
  console.log(`[install] sample project -> ${dest}`);
}

console.log('');
console.log('Next: open the project in TyranoBuilder (reopen it if it is already open).');
console.log('  A dialog reports the result; details land in <project>/ss_import_log.txt');
console.log(`  Converted packs appear under ${join(project, 'data/others/ssdata')}`);
