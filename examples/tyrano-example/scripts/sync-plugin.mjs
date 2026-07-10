// Copy the freshly-built ssplayer-tyrano plugin assets into this TyranoScript
// project's plugin folder. Both files are git-ignored build artefacts — run
// this after `pnpm --filter @spritestudio/ssplayer-tyrano run build`.
//
//   main.js            ← packages/ssplayer-tyrano/dist/browser/main.js (IIFE, self-registers [ss_*])
//   ssruntime_bg.wasm  ← packages/ssplayer-core/dist/ssruntime_bg.wasm (the runtime binary)
//
// The wasm is kept external (not bundled into main.js); [ss_init wasm=...]
// points at it. Ship both alongside each other.
import { copyFile, mkdir, access } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../..');
const destDir = resolve(here, '../data/others/plugin/ssplayer');

const copies = [
  {
    from: resolve(repoRoot, 'packages/ssplayer-tyrano/dist/browser/main.js'),
    to: resolve(destDir, 'main.js'),
  },
  {
    from: resolve(repoRoot, 'packages/ssplayer-core/dist/ssruntime_bg.wasm'),
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
        `  → build first: pnpm --filter @spritestudio/ssplayer-tyrano run build`,
    );
    process.exit(1);
  }
  await copyFile(from, to);
  console.log(`[sync-plugin] ${from}\n            → ${to}`);
}
console.log('[sync-plugin] done.');
