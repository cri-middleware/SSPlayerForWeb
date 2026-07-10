// Copy the freshly-built ssplayer-rmmz plugin assets into this RPG Maker MZ
// project's js/plugins/ folder. Both files are git-ignored build artefacts —
// run this after `pnpm --filter @spritestudio/ssplayer-rmmz run build`.
//
//   ssplayer-rpgmakermz.js  ← packages/ssplayer-rmmz/dist/browser/ (IIFE, self-registers)
//   ssruntime_bg.wasm       ← packages/ssplayer-core/wasm-nosimd/ (no-SIMD runtime;
//                             RPG Maker MZ's bundled NW.js lacks WASM simd128)
//
// The plugin auto-loads its wasm from the same folder (document.currentScript),
// so both files must sit together in js/plugins/. Registration in js/plugins.js
// is committed with the SampleProject; this only refreshes the build artefacts.
import { copyFile, mkdir, access } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../..');
const destDir = resolve(here, '../SampleProject/js/plugins');

const copies = [
  {
    from: resolve(repoRoot, 'packages/ssplayer-rmmz/dist/browser/ssplayer-rpgmakermz.js'),
    to: resolve(destDir, 'ssplayer-rpgmakermz.js'),
  },
  {
    from: resolve(repoRoot, 'packages/ssplayer-core/wasm-nosimd/ssruntime_bg.wasm'),
    to: resolve(destDir, 'ssruntime_bg.wasm'),
  },
];

await mkdir(destDir, { recursive: true });
for (const { from, to } of copies) {
  try {
    await access(from);
  } catch {
    console.error(
      `[sync-plugin] missing ${from}\n` +
        `  → build first: pnpm --filter @spritestudio/ssplayer-rmmz run build`,
    );
    process.exit(1);
  }
  await copyFile(from, to);
  console.log(`[sync-plugin] ${from}\n            → ${to}`);
}
console.log('[sync-plugin] done.');
