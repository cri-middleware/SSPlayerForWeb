// Deploy the built plugin + a SpriteStudio source project into the bundled
// RPG Maker MZ example, so you can test in NW.js without copying by hand.
//
// It does two things:
//   1. Plugin deploy  — copies the runtime plugin + WASM (and, unless
//      --no-dev, the developer converter + its WASM) into
//      examples/rmmz-example/SampleProject/js/plugins/, and ensures both are
//      registered in js/plugins.js.
//   2. Source deploy  — copies the top-level source files of each named
//      SpriteStudio test project (default: Ringo) into
//      examples/rmmz-example/SampleProject/ss_source/<name>/, so the developer
//      converter turns them into .ssab on the next test-play.
//
// Usage:
//   node scripts/deploy-example.mjs                # plugin + Ringo source
//   node scripts/deploy-example.mjs Ringo Mesh     # specific projects
//   node scripts/deploy-example.mjs --all          # every tests/* project
//   node scripts/deploy-example.mjs --no-dev       # skip the dev converter
//   node scripts/deploy-example.mjs --no-source    # plugin only
//
// Run `pnpm --filter @spritestudio/ssplayer-rmmz build` first.
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(here, '..');
const repoRoot = resolve(pkgRoot, '../..');
const example = join(repoRoot, 'examples/rmmz-example/SampleProject');
const pluginsDir = join(example, 'js/plugins');
const sourceDir = join(example, 'ss_source');
const testsDir = join(repoRoot, 'SpriteStudio-SDK/tests');

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith('--')));
const projectArgs = args.filter((a) => !a.startsWith('--'));
const withDev = !flags.has('--no-dev');
const withSource = !flags.has('--no-source');

if (!existsSync(example)) {
  console.error(`[deploy] example project not found: ${example}`);
  process.exit(1);
}

// --- 1. Plugin deploy ---------------------------------------------------------

const runtimeJs = join(pkgRoot, 'dist/browser/ssplayer-rpgmakermz.js');
const runtimeWasm = join(repoRoot, 'packages/ssplayer-core/wasm/ssruntime_bg.wasm');
const devJs = join(pkgRoot, 'dist/browser/ssplayer-rpgmakermz-devconvert.js');
const devWasm = join(repoRoot, 'packages/ssconverter-core/wasm/ssconverter_bg.wasm');

if (!existsSync(runtimeJs) || !existsSync(runtimeWasm)) {
  console.error(
    `[deploy] missing build output. Run: pnpm --filter @spritestudio/ssplayer-rmmz build`,
  );
  process.exit(1);
}

mkdirSync(pluginsDir, { recursive: true });
copyInto(runtimeJs, pluginsDir);
copyInto(runtimeWasm, pluginsDir);
if (withDev && existsSync(devJs) && existsSync(devWasm)) {
  copyInto(devJs, pluginsDir);
  copyInto(devWasm, pluginsDir);
}
ensurePluginsRegistered(withDev);

// --- 2. Source deploy ---------------------------------------------------------

if (withSource) {
  let projects = projectArgs;
  if (flags.has('--all')) {
    projects = readdirSync(testsDir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && findSspj(join(testsDir, e.name)))
      .map((e) => e.name);
  } else if (projects.length === 0) {
    projects = ['Ringo'];
  }

  for (const name of projects) {
    const projDir = join(testsDir, name);
    const sspj = findSspj(projDir);
    if (!sspj) {
      console.warn(`[deploy] no .sspj in tests/${name} — skipped`);
      continue;
    }
    const outDir = join(sourceDir, name);
    mkdirSync(outDir, { recursive: true });
    // Copy the project's top-level source files only (skip nested pre-built
    // output dirs, binaries and heavy .psd).
    let n = 0;
    for (const entry of readdirSync(projDir, { withFileTypes: true })) {
      if (!entry.isFile() || entry.name.startsWith('.')) continue;
      const lower = entry.name.toLowerCase();
      if (lower.endsWith('.ssab') || lower.endsWith('.ssqb') || lower.endsWith('.psd')) continue;
      copyFileSync(join(projDir, entry.name), join(outDir, entry.name));
      n++;
    }
    console.log(`[deploy] source: tests/${name} -> ss_source/${name} (${n} files)`);
  }
}

console.log('[deploy] done. Test with: nw examples/rmmz-example/SampleProject');

// --- helpers ------------------------------------------------------------------

function copyInto(src, destDir) {
  const dest = join(destDir, basename(src));
  copyFileSync(src, dest);
  console.log(`[deploy] plugin: ${basename(src)}`);
}

function findSspj(dir) {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return null;
  const hit = readdirSync(dir).find((f) => f.toLowerCase().endsWith('.sspj'));
  return hit ? join(dir, hit) : null;
}

// Ensure js/plugins.js contains our plugin entries (idempotent). Preserves any
// OTHER existing entries; appends ours if missing. Parses the `$plugins` array
// by pulling out its `{...}` object literals (one per line, RPG Maker format).
function ensurePluginsRegistered(includeDev) {
  const file = join(example, 'js/plugins.js');
  const text = existsSync(file) ? readFileSync(file, 'utf8') : '';

  const ours = [
    '{"name":"ssplayer-rpgmakermz","status":true,"description":"SpriteStudio player for RPG Maker MZ (PixiJS v5 direct-draw).","parameters":{}}',
  ];
  if (includeDev) {
    ours.push(
      '{"name":"ssplayer-rpgmakermz-devconvert","status":true,"description":"[DEV ONLY] Auto-converts .sspj to .ssab on NW.js test-play.","parameters":{"sourceDir":"ss_source","outDir":"img/spritestudio"}}',
    );
  }

  // Existing entry object literals, keyed by plugin name. Parse line-by-line
  // (RPG Maker writes one entry per line) and strip any trailing comma, so
  // entries ending in "}," are preserved and third-party plugins never dropped.
  const existing = text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('{"name":'))
    .map((l) => l.replace(/,\s*$/, ''));
  const byName = new Map();
  for (const line of existing) {
    const m = line.match(/"name":"([^"]+)"/);
    if (m) byName.set(m[1], line);
  }
  const added = [];
  for (const line of ours) {
    const name = line.match(/"name":"([^"]+)"/)[1];
    if (!byName.has(name)) {
      byName.set(name, line);
      added.push(name);
    }
  }
  if (added.length === 0) {
    console.log('[deploy] plugins.js already registered');
    return;
  }
  const body = [...byName.values()].join(',\n');
  const out = `// Generated by RPG Maker.\n// Do not edit this file directly.\nvar $plugins =\n[\n${body}\n];\n`;
  writeFileSync(file, out);
  console.log(`[deploy] plugins.js: registered ${added.join(', ')}`);
}
