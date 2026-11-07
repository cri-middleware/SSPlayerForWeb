// Copy the ssplayer-tyranoscript plugin folder into this TyranoScript project.
// Run this after `pnpm --filter @spritestudio/ssplayer-tyranoscript run build`.
//
//   main.js            ← packages/ssplayer-tyranoscript/dist/browser/main.js (IIFE, self-registers [ss_*])
//   ssruntime_bg.wasm  ← packages/ssplayer-core/dist/ssruntime_bg.wasm (the runtime binary)
//   init.ks            ← packages/ssplayer-tyranoscript/plugin/init.ks (the loader [plugin] calls)
//
// The wasm is kept external (not bundled into main.js); [ss_init wasm=...]
// points at it. Ship all three alongside each other.
//
// `init.ks` is synced — not hand-maintained here — because it is the plugin's
// canonical loader, and this example exists to demonstrate exactly what a real
// project gets.
import { copyFile, mkdir, access } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../..');
const destDir = resolve(here, '../data/others/plugin/ssplayer');

const copies = [
  {
    from: resolve(repoRoot, 'packages/ssplayer-tyranoscript/dist/browser/main.js'),
    to: resolve(destDir, 'main.js'),
  },
  {
    from: resolve(repoRoot, 'packages/ssplayer-core/dist/ssruntime_bg.wasm'),
    to: resolve(destDir, 'ssruntime_bg.wasm'),
  },
  {
    from: resolve(repoRoot, 'packages/ssplayer-tyranoscript/plugin/init.ks'),
    to: resolve(destDir, 'init.ks'),
  },
];

await mkdir(destDir, { recursive: true });
for (const { from, to } of copies) {
  try {
    await access(from);
  } catch {
    console.error(
      `[sync-plugin] missing ${from}\n` +
        `  → build first: pnpm --filter @spritestudio/ssplayer-tyranoscript run build`,
    );
    process.exit(1);
  }
  await copyFile(from, to);
  console.log(`[sync-plugin] ${from}\n            → ${to}`);
}
console.log('[sync-plugin] done.');
