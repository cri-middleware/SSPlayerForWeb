// Download the official (browser-capable) TyranoScript engine and lay it into
// this example, mirroring the repo's `scripts/download-sdk.*` idiom (fetch a
// third-party runtime that is NOT committed here). The engine is git-ignored;
// only this example's authored files (scenario / plugin / ssdata) are tracked.
//
// Why fetch instead of using a hand-copied engine: a TyranoScript *desktop*
// export runs with `configSave = file`, whose save path needs Node `fs`
// (`require('fs')`) and, in a plain browser, makes the engine crash at boot
// (`init_game` reads `_system_config_bgm_volume` off a null system-variable
// object). The official repo is the browser build; we also force
// `configSave = webstorage` + a unique `projectID` below so it "just works".
//
// Usage:
//   node scripts/fetch-tyrano.mjs [ref]
//     ref: a git tag (e.g. v514) or branch (master). Resolution order:
//          arg > $TYRANO_REF > TYRANO_VERSION.txt > "master".
//
// Requires `curl` and `tar` on PATH (present on macOS/Linux and Windows 10+).
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = 'ShikemokuMK/tyranoscript';
const BRANCHES = new Set(['master', 'main']);
const PROJECT_ID = 'ssplayer_tyrano_example';

const here = dirname(fileURLToPath(import.meta.url));
const exampleRoot = resolve(here, '..');

function resolveRef() {
  const fromArg = process.argv[2];
  const fromEnv = process.env.TYRANO_REF;
  let fromFile = '';
  const vf = join(exampleRoot, 'TYRANO_VERSION.txt');
  if (existsSync(vf)) fromFile = readFileSync(vf, 'utf8').trim();
  return fromArg || fromEnv || fromFile || 'master';
}

function archiveUrl(ref) {
  // GitHub source archives: branches live under refs/heads, tags under refs/tags.
  const kind = BRANCHES.has(ref) ? 'heads' : 'tags';
  return `https://github.com/${REPO}/archive/refs/${kind}/${ref}.tar.gz`;
}

function need(cmd) {
  try {
    execFileSync(cmd, ['--version'], { stdio: 'ignore' });
  } catch {
    console.error(`[fetch-tyrano] '${cmd}' is required but not on PATH.`);
    process.exit(1);
  }
}

/**
 * Force this example's required settings into a freshly-downloaded Config.tjs:
 * remove any existing projectID / configSave setting lines and append ours, so
 * precedence is unambiguous. The engine reads only lines that start with `;` as
 * settings (`//` starts a comment), so ours start with one too.
 * `configSave = webstorage` is mandatory for a browser (the `file` mode is
 * desktop-only); `projectID` isolates our localStorage per origin.
 */
function patchConfig(systemDir) {
  const cfgPath = join(systemDir, 'Config.tjs');
  if (!existsSync(cfgPath)) {
    console.warn(`[fetch-tyrano] Config.tjs not found at ${cfgPath}; skipping patch.`);
    return;
  }
  const kept = readFileSync(cfgPath, 'utf8')
    .split('\n')
    .filter((line) => !/^[;\s]*(projectID|configSave)\s*=/.test(line));
  kept.push('');
  kept.push('; --- ssplayer-tyranoscript example overrides (added by fetch-tyrano.mjs) ---');
  kept.push(`;projectID = ${PROJECT_ID};`);
  kept.push(';configSave = webstorage;');
  kept.push('');
  writeFileSync(cfgPath, kept.join('\n'));
  console.log('[fetch-tyrano] Config.tjs: set projectID + configSave=webstorage (browser-safe).');
}

function main() {
  need('curl');
  need('tar');

  const ref = resolveRef();
  const url = archiveUrl(ref);
  console.log(`[fetch-tyrano] TyranoScript ref: ${ref}`);
  console.log(`[fetch-tyrano] downloading ${url}`);

  const tmp = mkdtempSync(join(tmpdir(), 'tyrano-'));
  try {
    const tarball = join(tmp, 'tyrano.tar.gz');
    execFileSync('curl', ['-fL', '--progress-bar', '-o', tarball, url], { stdio: 'inherit' });

    // Extract; the archive has a single top-level <repo>-<ref>/ dir — strip it.
    const extractDir = join(tmp, 'engine');
    mkdirSync(extractDir);
    execFileSync('tar', ['-xzf', tarball, '-C', extractDir, '--strip-components=1'], { stdio: 'inherit' });

    // Sanity: the engine tree must have index.html + tyrano/.
    if (!existsSync(join(extractDir, 'index.html')) || !existsSync(join(extractDir, 'tyrano'))) {
      console.error(`[fetch-tyrano] unexpected archive layout (no index.html / tyrano/). Contents: ${readdirSync(extractDir).join(', ')}`);
      process.exit(1);
    }

    // Lay the engine into the example WITHOUT clobbering our authored data
    // (scenario / others / ssdata). We take: index.html, tyrano/, data/system/.
    console.log('[fetch-tyrano] installing engine (index.html, tyrano/, data/system/) …');
    cpSync(join(extractDir, 'index.html'), join(exampleRoot, 'index.html'));

    const destTyrano = join(exampleRoot, 'tyrano');
    rmSync(destTyrano, { recursive: true, force: true });
    cpSync(join(extractDir, 'tyrano'), destTyrano, { recursive: true });

    const destSystem = join(exampleRoot, 'data', 'system');
    mkdirSync(destSystem, { recursive: true });
    const srcSystem = join(extractDir, 'data', 'system');
    if (existsSync(srcSystem)) cpSync(srcSystem, destSystem, { recursive: true });

    patchConfig(destSystem);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }

  console.log('[fetch-tyrano] done. Next:');
  console.log('  pnpm --filter tyranoscript-example run sync:plugin   # copy built plugin + wasm');
  console.log('  pnpm --filter tyranoscript-example run dev           # serve at http://localhost:5847');
}

main();
