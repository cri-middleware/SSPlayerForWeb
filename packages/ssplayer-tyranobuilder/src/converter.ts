// `.sspj` -> `.ssab` inside the editor, via `@spritestudio/ssconverter-core`.
//
// The core is environment-agnostic on purpose: it never touches a filesystem or
// the DOM, it takes the wasm bytes and a `Map<path, bytes>` of the project and
// hands back a `Map<name, bytes>`. That is exactly the shape this host needs,
// because in the builder the *host* is the only thing that can read files (via
// `studio_api`), and wasm cannot `fetch()` a `file://` URL anyway.

import { convertProject, init, version as converterVersion } from '@spritestudio/ssconverter-core';

import type { HostFs } from './hostFs.js';

let initialised: Promise<string> | null = null;

/**
 * Instantiate the converter wasm once per editor session. Resolves to the
 * converter's build version string.
 */
export function ensureConverter(fs: HostFs, wasmPath: string): Promise<string> {
  initialised ??= (async () => {
    if (!fs.exists(wasmPath)) {
      throw new Error(`converter wasm not found: ${wasmPath}`);
    }
    // `init` takes a BufferSource — the host reads the bytes itself, so the
    // usual `fetch(import.meta.url)` path (blocked for file://) is not used.
    await init(fs.readBinary(wasmPath));
    return converterVersion();
  })();
  return initialised;
}

export interface ConvertStats {
  /** Files read out of the source project directory. */
  inputFiles: number;
  /** Files written into the output directory. */
  outputFiles: number;
  /** Referenced textures copied alongside the `.ssab`. */
  copiedAssets: number;
  /** Names of the generated `.ssab` files. */
  ssab: string[];
  elapsedMs: number;
}

/**
 * Convert one `.sspj` into `outDir`.
 *
 * Mirrors `packages/ssconverter-web/scripts/cli.js`: keys in the input map are
 * paths relative to the `.sspj`'s own directory, and non-embedded output ships
 * the textures as sibling files (`result.assets` maps destination -> source).
 *
 * Synchronous wasm work — it blocks the editor UI for its duration. Acceptable
 * for a PoC; a Worker is the fix (the core's byte-in/byte-out API already suits
 * one, since a Worker has no filesystem access of its own).
 */
export function convertProjectAt(
  fs: HostFs,
  sspjPath: string,
  outDir: string,
  now: () => number,
): ConvertStats {
  const started = now();
  const sourceDir = fs.path.dirname(sspjPath);

  const files = new Map<string, Uint8Array>();
  for (const full of fs.walkFiles(sourceDir)) {
    const rel = fs.path.relative(sourceDir, full).replace(/\\/g, '/');
    files.set(rel, fs.readBinary(full));
  }
  if (files.size === 0) {
    throw new Error(`no readable files under ${sourceDir}`);
  }

  const result = convertProject(files, { embedded: false });

  const stats: ConvertStats = {
    inputFiles: files.size,
    outputFiles: 0,
    copiedAssets: 0,
    ssab: [],
    elapsedMs: 0,
  };

  try {
    fs.mkdirp(outDir);

    for (const [name, data] of result.output.entries() as IterableIterator<[string, Uint8Array]>) {
      const dest = fs.resolveWithin(outDir, name, 'output path');
      fs.writeBinary(dest, data);
      stats.outputFiles++;
      if (name.toLowerCase().endsWith('.ssab')) stats.ssab.push(name);
    }

    // Textures: a Node-side `copySync`, so these bytes never cross the bridge.
    for (const [destPath, srcPath] of result.assets.entries() as IterableIterator<[string, string]>) {
      const src = fs.resolveWithin(sourceDir, srcPath, 'asset source path');
      const dest = fs.resolveWithin(outDir, destPath, 'asset output path');
      if (!fs.exists(src)) continue;
      fs.mkdirp(fs.path.dirname(dest));
      fs.copy(src, dest);
      stats.copiedAssets++;
    }
  } finally {
    // Release the wasm-side result now rather than waiting for the
    // FinalizationRegistry — this process converts repeatedly and stays alive
    // for as long as the editor is open.
    result.free();
  }

  stats.elapsedMs = Math.round(now() - started);
  return stats;
}
