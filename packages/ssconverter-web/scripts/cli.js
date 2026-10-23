#!/usr/bin/env node

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { init, convertProject, applySuffix } from '@spritestudio/ssconverter-core';

// Parse arguments
const args = process.argv.slice(2);
let outDir = '';
let sspjPath = '';
let embedded = false;
let suffix = '';
let stemDir = false;

for (let i = 0; i < args.length; i++) {
    if (args[i] === '-o') {
        outDir = args[++i];
    } else if (args[i] === '-e' || args[i] === '--embedded') {
        // Inline each texture's bytes into the .ssab (no sibling image files).
        embedded = true;
    } else if (args[i] === '--suffix') {
        // Append to each generated .ssab basename (e.g. "_embedded"); in this
        // mode only .ssab files are written (renamed) and referenced external
        // assets are NOT copied — used to emit embedded variants alongside the
        // normal external outputs without name clashes.
        suffix = args[++i];
    } else if (args[i] === '--stem-dir') {
        // Nest the output under <out_dir>/<sspj-stem>/ instead of writing flat
        // into <out_dir>. Useful for hosts that expect one folder per project
        // (e.g. RPG Maker MZ: spritestudio/<sspj-stem>/<ssae-stem>.ssab).
        stemDir = true;
    } else {
        sspjPath = args[i];
    }
}

if (!sspjPath) {
    console.error('Usage: node cli.js [-o output_dir] [-e|--embedded] [--suffix <s>] [--stem-dir] <project.sspj>');
    process.exit(1);
}

if (!outDir) {
    outDir = path.dirname(sspjPath);
}

// Opt-in: write into a per-project subfolder named after the .sspj stem.
if (stemDir) {
    outDir = path.join(outDir, path.basename(sspjPath, '.sspj'));
}

// Ensure the SSPJ exists
if (!fs.existsSync(sspjPath)) {
    console.error(`Error: File not found: ${sspjPath}`);
    process.exit(1);
}

// Load the WASM shipped inside @spritestudio/ssconverter-core. The core is
// fs-agnostic, so the host reads the bytes and hands them to init().
const wasmPath = fileURLToPath(
    import.meta.resolve('@spritestudio/ssconverter-core/wasm/ssconverter_bg.wasm'),
);

if (!fs.existsSync(wasmPath)) {
    console.error(`Error: WASM not found at ${wasmPath}. Run \`pnpm download:wasm\` (or \`pnpm build:wasm\`) first.`);
    process.exit(1);
}

// Resolve `target` under `baseDir` and refuse anything that escapes it. Output
// filenames and asset paths are derived from the (potentially untrusted) project,
// so a crafted `.sspj` yielding `../…` entries must not read or write outside the
// intended directory (zip-slip-style traversal).
function resolveWithin(baseDir, target, label) {
    const base = path.resolve(baseDir);
    const resolved = path.resolve(base, target);
    if (resolved !== base && !resolved.startsWith(base + path.sep)) {
        console.error(`Error: ${label} escapes the target directory: ${target}`);
        process.exit(1);
    }
    return resolved;
}

async function main() {
    await init(fs.readFileSync(wasmPath));

    const sspjDir = path.dirname(sspjPath);

    // Read all files in the directory recursively
    const filesMap = new Map();

    function readDirRecursive(dir) {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                readDirRecursive(fullPath);
            } else {
                const relativePath = path.relative(sspjDir, fullPath).replace(/\\/g, '/');
                // Exactly one .sspj tells the converter which project this is;
                // leave out any other (a backup beside it, a project below it).
                if (relativePath !== path.basename(sspjPath) && relativePath.toLowerCase().endsWith('.sspj')) continue;
                filesMap.set(relativePath, new Uint8Array(fs.readFileSync(fullPath)));
            }
        }
    }

    console.log(`Reading project directory: ${sspjDir}...`);
    readDirRecursive(sspjDir);
    console.log(`Read ${filesMap.size} files. Converting...`);

    const result = convertProject(filesMap, { embedded });

    // Suffix mode renames .ssab outputs and drops everything else, so embedded
    // variants sit next to the external outputs without clobbering them.
    const outputs = suffix ? applySuffix(result.output, suffix) : result.output;

    // Save generated files
    fs.mkdirSync(outDir, { recursive: true });

    for (const [filename, data] of outputs.entries()) {
        const dest = resolveWithin(outDir, filename, 'output path');
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, data);
        console.log(`Generated: ${dest}`);
    }

    // Copy referenced assets (skipped in suffix mode — embedded .ssab inline them).
    if (result.assets && !suffix) {
        for (const [destPath, srcPath] of result.assets.entries()) {
            const srcFullPath = resolveWithin(sspjDir, srcPath, 'asset source path');
            const destFullPath = resolveWithin(outDir, destPath, 'asset output path');

            if (fs.existsSync(srcFullPath)) {
                fs.mkdirSync(path.dirname(destFullPath), { recursive: true });
                fs.copyFileSync(srcFullPath, destFullPath);
                console.log(`Copied asset: ${srcFullPath} -> ${destFullPath}`);
            } else {
                console.warn(`WARNING: Source asset not found: ${srcFullPath}`);
            }
        }
    }

    console.log('Conversion successful!');
}

main().catch(e => {
    console.error('Error during conversion:', e);
    process.exit(1);
});
