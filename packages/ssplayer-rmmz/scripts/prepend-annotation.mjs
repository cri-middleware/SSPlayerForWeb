// Prepend the RPG Maker MZ plugin annotation (/*: and /*:ja) to each built IIFE.
// MZ reads this comment block at the very top of the .js to build its plugin
// settings UI; bundlers strip comments, so we re-attach it here after the build.
// Wired into the `build` npm script (tsdown && node scripts/prepend-annotation.mjs).
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, '..');

const pairs = [
  ['src/plugin-annotation.js', 'dist/browser/ssplayer-rpgmakermz.js'],
  ['src/devconvert-annotation.js', 'dist/browser/ssplayer-rpgmakermz-devconvert.js'],
];

for (const [annPath, outPath] of pairs) {
  const out = join(pkgRoot, outPath);
  if (!existsSync(out)) continue; // that bundle wasn't built
  const annotation = readFileSync(join(pkgRoot, annPath), 'utf8').trimEnd();
  const body = readFileSync(out, 'utf8');
  if (body.startsWith(annotation)) continue; // already prepended (idempotent)
  writeFileSync(out, `${annotation}\n\n${body}`);
  console.log(`[annotate] prepended ${annPath} -> ${outPath}`);
}
