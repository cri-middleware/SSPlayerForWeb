// What goes into a `ssplayer` plugin folder, shared by the installer and the
// `.tbp` packer so the two can never drift.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Both the folder name inside the archive and the required `.tbp` filename:
 * `addPlugin()` derives the id from the filename and then reads
 * `<id>/<id>.builder.js` out of what it just extracted.
 */
export const PLUGIN_ID = 'ssplayer';

/**
 * One plugin folder, two halves.
 *
 * The editor half is this package. The runtime half is
 * `@spritestudio/ssplayer-tyrano`'s `main.js`, which registers the `[ss_*]` tags
 * the components write — without it a GUI-built scenario parses fine and then
 * dies at run time on an unknown `[ss_init]`, with nothing visible in the
 * editor. `init.ks` ties them together (see the README).
 *
 * Shipping both in one folder also keeps the plugin budget at one: non-Steam
 * builds refuse the third plugin, and count anything holding a `.builder.js`.
 */
export function pluginFiles(repoRoot, pkgRoot) {
  return [
    {
      // The builder finds the editor half by name: <id>/<id>.builder.js.
      name: `${PLUGIN_ID}.builder.js`,
      path: join(pkgRoot, 'dist/ssplayer.builder.js'),
      hint: 'pnpm --filter @spritestudio/ssplayer-tyranobuilder run build',
    },
    {
      name: 'ssconverter_bg.wasm',
      path: join(repoRoot, 'packages/ssconverter-core/wasm/ssconverter_bg.wasm'),
      hint: 'pnpm download:wasm',
    },
    {
      name: 'main.js',
      path: join(repoRoot, 'packages/ssplayer-tyrano/dist/browser/main.js'),
      hint: 'pnpm --filter @spritestudio/ssplayer-tyrano run build',
    },
    {
      name: 'ssruntime_bg.wasm',
      path: join(repoRoot, 'packages/ssplayer-core/dist/ssruntime_bg.wasm'),
      hint: 'pnpm download:wasm && pnpm --filter @spritestudio/ssplayer-core run build',
    },
    {
      name: 'init.ks',
      path: join(repoRoot, 'packages/ssplayer-tyrano/plugin/init.ks'),
      hint: null,
    },
  ];
}

/** Component labels; the builder merges these before importing the plugin. */
export function langFiles(pkgRoot) {
  const dir = join(pkgRoot, 'lang');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((name) => ({ name, path: join(dir, name), hint: null }));
}

/** Exits with a build hint when any source file is missing. */
export function requireAll(files, fail) {
  for (const { name, path, hint } of files) {
    if (!existsSync(path)) {
      fail(`missing ${name}: ${path}${hint ? `\n  → build it first: ${hint}` : ''}`);
    }
  }
}

/**
 * The builder hands `<id>.builder.js` straight to `import()`, which resolves
 * nothing: one surviving bare specifier rejects the import and the plugin never
 * loads — no error in the UI, no log entry, just missing components. Catch it
 * here, where there is somewhere to print it.
 */
export function requireSelfContained(bundlePath, fail) {
  const source = readFileSync(bundlePath, 'utf8');
  const bare = [
    // `import … from "pkg"` / `export … from "pkg"`, and side-effect `import "pkg"`.
    ...source.matchAll(/^\s*(?:import|export)[^'"]*from\s*['"]([^.'"][^'"]*)['"]/gm),
    ...source.matchAll(/^\s*import\s*['"]([^.'"][^'"]*)['"]/gm),
  ].map((m) => m[1]);

  if (bare.length > 0) {
    fail(
      `the bundle still imports ${[...new Set(bare)].join(', ')}.\n` +
        '  TyranoBuilder cannot resolve bare specifiers — add them to `deps.alwaysBundle` in tsdown.config.ts.',
    );
  }
}
