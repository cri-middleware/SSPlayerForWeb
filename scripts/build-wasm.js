const { spawnSync } = require('child_process');
const os = require('os');

const isWin = os.platform() === 'win32';
const command = isWin ? 'powershell' : 'bash';

let mode = 'debug';
if (process.argv.includes('--release') || process.argv.includes('build=release') || process.argv.includes('release')) {
    mode = 'release';
}

const args = isWin 
    ? ['-ExecutionPolicy', 'Bypass', '-File', 'scripts/build-runtime.ps1', `build=${mode}`] 
    : ['scripts/build-runtime.sh', `build=${mode}`];

console.log(`[build:wasm] Running on ${os.platform()}... executing ${args[isWin ? 3 : 0]} in ${mode} mode`);

const result = spawnSync(command, args, { stdio: 'inherit' });

process.exit(result.status !== null ? result.status : 1);
