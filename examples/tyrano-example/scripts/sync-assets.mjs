// Copy the SS test assets (reference .ssab + its texture PNG) into this example's
// data/others/ssdata/. These are generated, git-ignored assets — the canonical
// source is examples/webgl-example/public/, populated by `pnpm deploy-examples`
// (which compiles the SpriteStudio-SDK test projects with ssconverter).
//
// We use the REFERENCE ssab (Ringo.ssab + Ringo.png) rather than the embedded
// variant, so the example exercises real texture-path resolution (assetBase →
// sibling PNG), matching a typical SpriteStudio export.
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const exampleRoot = resolve(here, '..');
const src = resolve(exampleRoot, '../webgl-example/public');
const destDir = join(exampleRoot, 'data', 'others', 'ssdata');

// Reference ssab + its sibling texture(s). Add more pairs here as the example grows.
const ASSETS = ['Ringo.ssab', 'Ringo.png'];

const missing = ASSETS.filter((a) => !existsSync(join(src, a)));
if (missing.length) {
  console.error(
    `[sync-assets] missing in ${src}: ${missing.join(', ')}\n` +
      '  → generate them first: pnpm deploy-examples (compiles the SDK test assets)',
  );
  process.exit(1);
}

mkdirSync(destDir, { recursive: true });
for (const a of ASSETS) {
  copyFileSync(join(src, a), join(destDir, a));
  console.log(`[sync-assets] ${a} → data/others/ssdata/${a}`);
}
console.log('[sync-assets] done.');
