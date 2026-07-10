// Developer-only auto-importer: on NW.js test-play, convert any .sspj dropped in
// <game>/ss_source/ to .ssab under <game>/img/spritestudio/<project>/, using
// ssconverter-core (WASM). Modelled on SSPlayerForRenPy's auto_importer.rpy:
// mtime-cached (only rebuilds when a source file is newer than every output),
// and a no-op outside NW.js (deployed browser/mobile games have no fs, so they
// ship pre-converted .ssab and never run this).

import { init, convertProject, locateProject } from '@spritestudio/ssconverter-core';

// Node built-ins are only available under NW.js; resolve them lazily via the
// global require so bundling for the browser never pulls them in.
type NodeFS = typeof import('node:fs');
type NodePath = typeof import('node:path');
function nodeModules(): { fs: NodeFS; path: NodePath } | null {
  const req = (globalThis as any).require;
  if (typeof req !== 'function') return null;
  try {
    return { fs: req('fs'), path: req('path') };
  } catch {
    return null;
  }
}

/** The game root directory (where index.html lives) — MZ's canonical trick. */
export function getBaseDir(path: NodePath): string {
  const mainModule = (globalThis as any).process?.mainModule;
  const filename = mainModule?.filename ?? (globalThis as any).process?.cwd?.() ?? '.';
  return mainModule?.filename ? path.dirname(filename) : filename;
}

let _wasmInited = false;

export interface AutoImportOptions {
  /** Source directory (relative to game root) scanned for .sspj. */
  sourceDir?: string;
  /** Output directory (relative to game root) for converted projects. */
  outDir?: string;
  /** Path to ssconverter_bg.wasm (relative to game root). */
  wasmPath: string;
}

/**
 * Run one auto-import pass. Safe to await from a Scene_Boot gate. Resolves when
 * every changed project has been (re)converted; no-op when not under NW.js.
 */
export async function runAutoImport(opts: AutoImportOptions): Promise<void> {
  const mods = nodeModules();
  if (!mods) return; // not NW.js — nothing to do
  const { fs, path } = mods;

  const base = getBaseDir(path);
  const sourceDir = path.join(base, opts.sourceDir ?? 'ss_source');
  const outRoot = path.join(base, opts.outDir ?? 'img/spritestudio');
  if (!fs.existsSync(sourceDir)) return;

  if (!_wasmInited) {
    const wasmBytes = fs.readFileSync(path.join(base, opts.wasmPath));
    await init(new Uint8Array(wasmBytes));
    _wasmInited = true;
  }

  for (const sspjPath of findFiles(fs, path, sourceDir, '.sspj')) {
    const projectDir = path.dirname(sspjPath);
    const projectName = path.basename(sspjPath, '.sspj');
    const projectOut = path.join(outRoot, projectName);

    if (!needsConversion(fs, path, projectDir, projectOut)) continue;

    // Read the whole project directory into a path->bytes map (keys use "/").
    const files = new Map<string, Uint8Array>();
    for (const abs of walk(fs, path, projectDir)) {
      const rel = path.relative(projectDir, abs).split(path.sep).join('/');
      files.set(rel, new Uint8Array(fs.readFileSync(abs)));
    }
    // Fail loudly (per project) but keep going for the others.
    try {
      locateProject(files.keys()); // validates exactly one .sspj
      const result = convertProject(files, { embedded: false, optimize: true });
      fs.mkdirSync(projectOut, { recursive: true });
      for (const [name, data] of result.output.entries()) {
        const dest = path.join(projectOut, name as string);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, Buffer.from(data as Uint8Array));
      }
      for (const [destPath, srcPath] of result.assets.entries()) {
        const srcAbs = path.join(projectDir, srcPath as string);
        const destAbs = path.join(projectOut, destPath as string);
        fs.mkdirSync(path.dirname(destAbs), { recursive: true });
        if (fs.existsSync(srcAbs)) fs.copyFileSync(srcAbs, destAbs);
      }
      (result as any).free?.();
      console.log(`[ssplayer-rmmz] converted "${projectName}" -> ${projectOut}`);
    } catch (e) {
      console.error(`[ssplayer-rmmz] failed to convert "${projectName}":`, e);
    }
  }
}

/** Rebuild when the newest source file is newer than the newest output file. */
function needsConversion(fs: NodeFS, path: NodePath, srcDir: string, outDir: string): boolean {
  const latestSrc = latestMtime(fs, path, srcDir);
  if (!fs.existsSync(outDir)) return true;
  const latestOut = latestMtime(fs, path, outDir);
  if (latestOut === 0) return true; // no output files yet
  return latestSrc > latestOut;
}

function latestMtime(fs: NodeFS, path: NodePath, dir: string): number {
  let latest = 0;
  for (const abs of walk(fs, path, dir)) {
    const m = fs.statSync(abs).mtimeMs;
    if (m > latest) latest = m;
  }
  return latest;
}

/** Recursively yield absolute file paths under `dir`, skipping dotfiles. */
function walk(fs: NodeFS, path: NodePath, dir: string): string[] {
  const out: string[] = [];
  const stack = [dir];
  while (stack.length) {
    const d = stack.pop()!;
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      const abs = path.join(d, entry.name);
      if (entry.isDirectory()) stack.push(abs);
      else out.push(abs);
    }
  }
  return out;
}

function findFiles(fs: NodeFS, path: NodePath, dir: string, ext: string): string[] {
  return walk(fs, path, dir).filter((f) => f.toLowerCase().endsWith(ext));
}
