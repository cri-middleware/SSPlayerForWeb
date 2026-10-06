#!/usr/bin/env node
// Set the version of one or more packages -- the decision a release makes by hand.
//
//   node scripts/set-versions.mjs ssplayer-core@7.0.0-beta.2
//   node scripts/set-versions.mjs ssplayer-core@7.0.0-beta.2 ssplayer-webgl@7.0.0-beta.2
//
// Each argument is <directory under packages/>@<version>. Two files of that
// package change, in place: the "version" field of its package.json, and its
// CHANGELOG.md, whose `## [Unreleased]` notes become `## [<version>] - <date>`
// under a fresh, empty `## [Unreleased]`. release.yml runs this with its
// `versions` input and then sync-doc-versions.mjs; run the same two locally to
// see what a release would build, and `git checkout -- .` to put the tree back.
//
// Packages are versioned independently, so a version moves only when it is named
// here. Every argument is checked before any file is written. A version may not
// go backwards: npm takes any version it has not seen, and one published by
// mistake can never be withdrawn. A version the CHANGELOG already has a heading
// for is released, and nothing under `## [Unreleased]` leaves a release with no
// notes. Naming the version a package already has cuts its first release.

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

const today = new Date().toISOString().slice(0, 10);
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
  if (order < 0) {
    errors.push(`${dir}: ${version} is lower than its current ${current}`);
    continue;
  }
  let next = null;
  if (order > 0) {
    const escaped = current.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    next = text.replace(new RegExp(`("version"\\s*:\\s*")${escaped}(")`), `$1${version}$2`);
    if (JSON.stringify({ ...JSON.parse(text), version }) !== JSON.stringify(JSON.parse(next))) {
      errors.push(`${dir}: "version" could not be changed alone in its package.json -- set it by hand`);
      continue;
    }
  }

  const logPath = join(ROOT, 'packages', dir, 'CHANGELOG.md');
  if (!existsSync(logPath)) {
    errors.push(`${dir}: there is no packages/${dir}/CHANGELOG.md`);
    continue;
  }
  const lines = readFileSync(logPath, 'utf8').split('\n');
  if (lines.some((l) => l.startsWith(`## [${version}]`))) {
    errors.push(`${dir}: ${version} is already released -- its CHANGELOG.md has a heading for it`);
    continue;
  }
  const top = lines.findIndex((l) => l.trimEnd() === '## [Unreleased]');
  if (top < 0) {
    errors.push(`${dir}: its CHANGELOG.md has no '## [Unreleased]' heading`);
    continue;
  }
  const end = lines.findIndex((l, i) => i > top && l.startsWith('## '));
  const notes = lines.slice(top + 1, end < 0 ? lines.length : end);
  if (!notes.some((l) => l.trim() !== '' && !l.startsWith('#'))) {
    errors.push(`${dir}: nothing under '## [Unreleased]' in its CHANGELOG.md -- write what ${version} gains first`);
    continue;
  }
  lines.splice(top, 1, '## [Unreleased]', '', `## [${version}] - ${today}`);
  plan.push({ dir, path, next, current, version, logPath, log: lines.join('\n') });
}

if (errors.length > 0) {
  for (const e of errors) console.error(`${APP}: ${e}`);
  console.error(`${APP}: nothing was written`);
  process.exit(1);
}

for (const p of plan) {
  if (p.next !== null) writeFileSync(p.path, p.next);
  writeFileSync(p.logPath, p.log);
  console.log(p.next !== null ? `${p.dir}: ${p.current} -> ${p.version}` : `${p.dir}: ${p.version}`);
}
