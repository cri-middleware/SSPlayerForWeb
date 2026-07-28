// What goes into a `ssplayer` plugin folder, shared by the installer and the
// `.tbp` packer so the two can never drift.
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

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
 * `@spritestudio/ssplayer-tyranoscript`'s `main.js`, which registers the `[ss_*]` tags
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
      path: join(repoRoot, 'packages/ssplayer-tyranoscript/dist/browser/main.js'),
      hint: 'pnpm --filter @spritestudio/ssplayer-tyranoscript run build',
    },
    {
      name: 'ssruntime_bg.wasm',
      path: join(repoRoot, 'packages/ssplayer-core/dist/ssruntime_bg.wasm'),
      hint: 'pnpm download:wasm && pnpm --filter @spritestudio/ssplayer-core run build',
    },
    {
      name: 'init.ks',
      path: join(repoRoot, 'packages/ssplayer-tyranoscript/plugin/init.ks'),
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
 * Load the bundle the way the host does, and check what it got.
 *
 * The builder hands `<id>.builder.js` straight to `import()`, which resolves
 * nothing: one surviving bare specifier rejects the import and the plugin never
 * loads — no error in the UI, no log entry, just missing components. Importing
 * it here reproduces that exactly, which grepping for import statements cannot
 * once the bundle is minified. It also catches a syntax error, or a rename that
 * loses the export the host constructs.
 *
 * Safe to run: the module only defines `plugin_setting`; the editor is what
 * constructs it, and without `window.studio_api` the constructor stands down.
 */
export async function verifyBundle(bundlePath, fail) {
  let module;
  try {
    module = await import(pathToFileURL(bundlePath).href);
  } catch (error) {
    if (error?.code === 'ERR_MODULE_NOT_FOUND') {
      fail(
        `the bundle imports something that cannot be resolved: ${error.message}\n` +
          '  TyranoBuilder resolves no bare specifiers — add the package to `deps.alwaysBundle` in tsdown.config.ts.',
      );
    }
    fail(`the bundle does not load: ${error?.message ?? error}`);
  }

  if (typeof module.plugin_setting !== 'function') {
    fail('the bundle has no `plugin_setting` export; the builder does `new module.plugin_setting(TB)`.');
  }
}
