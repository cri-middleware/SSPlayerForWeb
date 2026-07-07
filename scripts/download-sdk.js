const { spawnSync } = require('child_process');
const os = require('os');

const isWin = os.platform() === 'win32';
const command = isWin ? 'powershell' : 'bash';

const args = isWin
    ? ['-ExecutionPolicy', 'Bypass', '-File', 'scripts/download-sdk.ps1']
    : ['scripts/download-sdk.sh'];

console.log(`[download:wasm] Running on ${os.platform()}... fetching pre-built SDK WASM`);

const result = spawnSync(command, args, { stdio: 'inherit' });

process.exit(result.status !== null ? result.status : 1);
