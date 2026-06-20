const { spawnSync } = require('child_process');
const os = require('os');

const isWin = os.platform() === 'win32';
const command = isWin ? 'powershell' : 'bash';
const args = isWin 
    ? ['-ExecutionPolicy', 'Bypass', '-File', 'scripts/build-runtime.ps1'] 
    : ['scripts/build-runtime.sh'];

console.log(`[build:wasm] Running on ${os.platform()}... executing ${args[args.length - 1]}`);

const result = spawnSync(command, args, { stdio: 'inherit' });

process.exit(result.status !== null ? result.status : 1);
