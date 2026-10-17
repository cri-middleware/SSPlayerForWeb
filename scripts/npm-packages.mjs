#!/usr/bin/env node
// Print the packages under packages/ that go to npm -- every package.json
// without "private": true -- one directory name per line, each after the ones it
// depends on.
//
//   node scripts/npm-packages.mjs
//
// RELEASING.md walks this list to approve what a run staged and to publish by
// hand, in this order, so a version never reaches npm before what it depends on.
// build-release.sh picks the npm packages by the same "private" test.

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP = 'npm-packages';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

if (process.argv.length > 2) {
  console.error(`${APP}: takes no arguments (got '${process.argv[2]}')`);
  process.exit(2);
}

const packages = new Map();
for (const dir of readdirSync(join(ROOT, 'packages')).sort()) {
  const file = join(ROOT, 'packages', dir, 'package.json');
  if (!existsSync(file)) continue;
  const pkg = JSON.parse(readFileSync(file, 'utf8'));
  if (pkg.private) continue;
  packages.set(pkg.name, { dir, deps: Object.keys({ ...pkg.dependencies, ...pkg.peerDependencies }) });
}

const order = [];
const placed = new Set();
const place = (name, path) => {
  if (placed.has(name)) return;
  if (path.includes(name)) throw new Error(`${APP}: a dependency cycle through ${[...path, name].join(' -> ')}`);
  for (const dep of packages.get(name).deps) if (packages.has(dep)) place(dep, [...path, name]);
  placed.add(name);
  order.push(packages.get(name).dir);
};
for (const name of packages.keys()) place(name, []);
console.log(order.join('\n'));
