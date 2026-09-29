// npm-facing shim over scripts/run-example.{sh,ps1}: picks the twin for this OS and
// hands it the `example=<name>` it takes: `pnpm run example example=pixi`.
const { spawnSync } = require('child_process');
const os = require('os');

const isWin = os.platform() === 'win32';
const command = isWin ? 'powershell' : 'bash';
const script = isWin ? 'scripts/run-example.ps1' : 'scripts/run-example.sh';
const args = isWin ? ['-ExecutionPolicy', 'Bypass', '-File', script] : [script];

const result = spawnSync(command, [...args, ...process.argv.slice(2)], { stdio: 'inherit' });

process.exit(result.status !== null ? result.status : 1);
