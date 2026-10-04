#!/usr/bin/env node
// Set the version of one or more packages -- the decision a release makes by hand.
//
//   node scripts/set-versions.mjs ssplayer-core@7.0.0-beta.2
//   node scripts/set-versions.mjs ssplayer-core@7.0.0-beta.2 ssplayer-webgl@7.0.0-beta.2
//
// Each argument is <directory under packages/>@<version>. Only the "version"
// field of that package.json changes, in place, so the rest of the file stays as
// it was. release.yml runs this with its `versions` input and then
// sync-doc-versions.mjs; run the same two locally to see what a release would
// build, and `git checkout -- .` to put the tree back.
//
// Packages are versioned independently, so a version moves only when it is named
// here. Every argument is checked before any file is written, and a version may
// not go backwards: npm takes any version it has not seen, and one published by
// mistake can never be withdrawn.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP = 'set-versions';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function parse(version) {
  const m = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/.exec(version);
  if (!m) return null;
  return { core: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4] ? m[4].split('.') : [] };
}

// SemVer precedence: the core numerically, then a version with a prerelease part
// below the same version without one, then the prerelease identifiers in turn.
function compare(a, b) {
  for (let i = 0; i < 3; i++) {
    if (a.core[i] !== b.core[i]) return a.core[i] < b.core[i] ? -1 : 1;
  }
  if (a.pre.length === 0 || b.pre.length === 0) {
    return a.pre.length === b.pre.length ? 0 : a.pre.length === 0 ? 1 : -1;
  }
  for (let i = 0; i < Math.max(a.pre.length, b.pre.length); i++) {
    const x = a.pre[i];
    const y = b.pre[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const xn = /^\d+$/.test(x);
    const yn = /^\d+$/.test(y);
    if (xn && yn) {
      if (Number(x) !== Number(y)) return Number(x) < Number(y) ? -1 : 1;
    } else if (xn !== yn) {
      return xn ? -1 : 1;
    } else if (x !== y) {
      return x < y ? -1 : 1;
    }
  }
  return 0;
}

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error(`${APP}: name at least one <package>@<version>, e.g. ssplayer-core@7.0.0-beta.2`);
  process.exit(2);
}

const plan = [];
const errors = [];
const seen = new Set();
for (const arg of args) {
  const at = arg.lastIndexOf('@');
  const dir = at > 0 ? arg.slice(0, at) : '';
  const version = at > 0 ? arg.slice(at + 1) : '';
  const want = parse(version);
  if (!dir || dir.includes('/') || !want) {
    errors.push(`${arg}: expected <directory under packages/>@<x.y.z[-prerelease]>`);
    continue;
  }
  if (seen.has(dir)) {
    errors.push(`${dir}: named twice`);
    continue;
  }
  seen.add(dir);
  const path = join(ROOT, 'packages', dir, 'package.json');
  if (!existsSync(path)) {
    errors.push(`${dir}: there is no packages/${dir}/package.json`);
    continue;
  }
  const text = readFileSync(path, 'utf8');
  const current = JSON.parse(text).version ?? '';
  const have = parse(current);
  if (!have) {
    errors.push(`${dir}: its current version '${current}' is not one this script can compare`);
    continue;
  }
  const order = compare(want, have);
  if (order === 0) {
    errors.push(`${dir}: already ${current}`);
  } else if (order < 0) {
    errors.push(`${dir}: ${version} is lower than its current ${current}`);
  } else {
    const escaped = current.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const next = text.replace(new RegExp(`("version"\\s*:\\s*")${escaped}(")`), `$1${version}$2`);
    if (JSON.stringify({ ...JSON.parse(text), version }) !== JSON.stringify(JSON.parse(next))) {
      errors.push(`${dir}: "version" could not be changed alone in its package.json -- set it by hand`);
    } else {
      plan.push({ dir, path, next, current, version });
    }
  }
}

if (errors.length > 0) {
  for (const e of errors) console.error(`${APP}: ${e}`);
  console.error(`${APP}: nothing was written`);
  process.exit(1);
}

for (const p of plan) {
  writeFileSync(p.path, p.next);
  console.log(`${p.dir}: ${p.current} -> ${p.version}`);
}
