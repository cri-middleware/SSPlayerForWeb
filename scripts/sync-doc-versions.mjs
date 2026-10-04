#!/usr/bin/env node
// Keep the version-pinned package references in docs in sync with package.json.
//
// READMEs, the docs site and the CDN samples pin exact versions — jsdelivr and
// esm.sh URLs, and the `data-wasm` runtime URL that pairs with a player bundle.
// Packages are versioned INDEPENDENTLY, so a release that bumps one package and
// not another silently invalidates every snippet naming the other — and these
// snippets exist to be copy-pasted, so a stale pin is exactly the failure a
// reader cannot diagnose.
//
// (Deliberately no literal example version anywhere in this file: the scan below
// covers .mjs too, so a sample pin in these comments would rewrite itself every
// release and show up as spurious churn in the release commit.)
//
// This rewrites every `@spritestudio/<workspace-package>@<semver>` to that
// package's current version. Run it right after scripts/set-versions.mjs, before
// the release commit, so the docs ship correct in the same commit as the bump.
//
//   node scripts/sync-doc-versions.mjs            rewrite in place
//   node scripts/sync-doc-versions.mjs --check    report only, exit 1 if stale
//
// NOT rewritten: dist-tag references like `@spritestudio/ssplayer-webgl@beta`
// (the install instruction during the prerelease line) and bare, unversioned
// mentions — only a literal semver after the `@` is a pin.

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const checkOnly = process.argv.includes('--check');

// --- 1. name -> current version, from the workspace packages ----------------
const versions = new Map();
const pkgsDir = join(repoRoot, 'packages');
for (const entry of readdirSync(pkgsDir, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const manifest = join(pkgsDir, entry.name, 'package.json');
  if (!existsSync(manifest)) continue;
  const pkg = JSON.parse(readFileSync(manifest, 'utf8'));
  if (pkg.name?.startsWith('@spritestudio/')) versions.set(pkg.name, pkg.version);
}

if (versions.size === 0) {
  console.error('sync-doc-versions: no @spritestudio/* packages found under packages/');
  process.exit(1);
}

// --- 2. candidate files -----------------------------------------------------
// git ls-files so build outputs, node_modules and the SDK submodule are all
// excluded for free. Test trees are skipped: a fixture may pin a version on
// purpose, and rewriting it would break the assertion it exists to make.
const tracked = execFileSync('git', ['ls-files'], { cwd: repoRoot, encoding: 'utf8' })
  .split('\n')
  .filter(Boolean)
  .filter((f) => /\.(md|html|ts|tsx|js|mjs|cjs|vue)$/.test(f))
  .filter((f) => !f.startsWith('SpriteStudio-SDK/'))
  .filter((f) => !/(^|\/)(test|tests|__tests__)\//.test(f));

// `@scope/name@1.2.3-beta.4` — a literal semver only, so `@beta` is left alone.
const PIN = /(@spritestudio\/[a-z0-9-]+)@(\d+\.\d+\.\d+(?:-[0-9a-z.-]+)?)/gi;

// --- 3. rewrite -------------------------------------------------------------
const stale = [];
const unknown = new Set();
let filesChanged = 0;

for (const file of tracked) {
  const abs = join(repoRoot, file);
  const before = readFileSync(abs, 'utf8');
  if (!before.includes('@spritestudio/')) continue;

  let hits = 0;
  const after = before.replace(PIN, (match, name, found) => {
    const current = versions.get(name);
    if (!current) {
      unknown.add(name);
      return match;
    }
    if (current === found) return match;
    hits++;
    stale.push({ file, name, found, current });
    return `${name}@${current}`;
  });

  if (hits > 0) {
    filesChanged++;
    if (!checkOnly) writeFileSync(abs, after);
  }
}

// --- 4. report --------------------------------------------------------------
for (const name of unknown) {
  console.error(`sync-doc-versions: ⚠ ${name} is pinned in docs but is not a workspace package — left as-is`);
}

if (stale.length === 0) {
  console.error(`✓ sync-doc-versions: all version pins match package.json (${tracked.length} files scanned)`);
  process.exit(0);
}

// One line per (file, package) rather than per occurrence — a snippet-heavy
// README pins the same package five times and five identical lines say nothing.
// The key only has to be unique; the record it maps to carries the fields, so
// nothing needs packing into a string and splitting back out (a path may well
// contain whatever separator we picked).
const grouped = new Map();
for (const entry of stale) {
  const key = JSON.stringify([entry.file, entry.name, entry.found, entry.current]);
  const seen = grouped.get(key);
  if (seen) seen.count++;
  else grouped.set(key, { ...entry, count: 1 });
}
const verb = checkOnly ? 'stale' : 'updated';
for (const { file, name, found, current, count } of grouped.values()) {
  const times = count > 1 ? ` x${count}` : '';
  console.error(`  ${relative('.', file)}: ${name}@${found} -> @${current}${times} (${verb})`);
}

if (checkOnly) {
  console.error(
    `\n✗ sync-doc-versions: ${stale.length} pin(s) in ${filesChanged} file(s) do not match package.json.\n` +
      `  Run: node scripts/sync-doc-versions.mjs\n`
  );
  process.exit(1);
}

console.error(`\n✓ sync-doc-versions: rewrote ${stale.length} pin(s) across ${filesChanged} file(s).`);
