#!/usr/bin/env node

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

// Parse arguments
const args = process.argv.slice(2);
let outDir = '';
let sspjPath = '';

for (let i = 0; i < args.length; i++) {
    if (args[i] === '-o') {
        outDir = args[++i];
    } else {
        sspjPath = args[i];
    }
}

if (!sspjPath) {
    console.error('Usage: node cli.js [-o output_dir] <project.sspj>');
    process.exit(1);
}

if (!outDir) {
    outDir = path.dirname(sspjPath);
}

// Ensure the SSPJ exists
if (!fs.existsSync(sspjPath)) {
    console.error(`Error: File not found: ${sspjPath}`);
    process.exit(1);
}

// Load WASM
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const wasmPath = path.resolve(__dirname, '../wasm/ssconverter_bg.wasm');

if (!fs.existsSync(wasmPath)) {
    console.error(`Error: WASM not found at ${wasmPath}. Please build WASM first.`);
    process.exit(1);
}

const wasmBuffer = fs.readFileSync(wasmPath);

import init, { convert } from '../wasm/ssconverter.js';

async function main() {
    await init({ module_or_path: wasmBuffer });
    
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
                filesMap.set(relativePath, new Uint8Array(fs.readFileSync(fullPath)));
            }
        }
    }
    
    console.log(`Reading project directory: ${sspjDir}...`);
    readDirRecursive(sspjDir);
    console.log(`Read ${filesMap.size} files. Converting...`);
    
    // Call wasm convert
    const result = convert(filesMap, false, false, false, true);
    
    // Save generated files
    fs.mkdirSync(outDir, { recursive: true });
    
    for (const [filename, data] of result.output.entries()) {
        const dest = path.join(outDir, filename);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, data);
        console.log(`Generated: ${dest}`);
    }
    
    // Copy referenced assets
    if (result.assets) {
        for (const [destPath, srcPath] of result.assets.entries()) {
            const srcFullPath = path.join(sspjDir, srcPath);
            const destFullPath = path.join(outDir, destPath);
            
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
