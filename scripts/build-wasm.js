// npm-facing shim over scripts/build-runtime.{sh,ps1}: picks the twin for this
// OS and hands it the build mode as the `build=<mode>` those scripts take.
//
// The default is **release**, the same default build-runtime has on its own. It
// used to be debug here, so `pnpm run build:wasm` -- the command CONTRIBUTING
// and the READMEs give -- produced a debug runtime while running the script
// directly produced a release one. Pass `debug` (or `build=debug`, or
// `--debug`) for the quick one.
const { spawnSync } = require('child_process');
const os = require('os');

const isWin = os.platform() === 'win32';
const command = isWin ? 'powershell' : 'bash';

const DEBUG_SPELLINGS = ['--debug', 'build=debug', 'debug'];
const RELEASE_SPELLINGS = ['--release', 'build=release', 'release'];

const argv = process.argv.slice(2);
const wants = (spellings) => argv.some((a) => spellings.includes(a));

if (wants(DEBUG_SPELLINGS) && wants(RELEASE_SPELLINGS)) {
    console.error('[build:wasm] both a debug and a release mode were asked for');
    process.exit(2);
}

const mode = wants(DEBUG_SPELLINGS) ? 'debug' : 'release';

const args = isWin
    ? ['-ExecutionPolicy', 'Bypass', '-File', 'scripts/build-runtime.ps1', `build=${mode}`]
    : ['scripts/build-runtime.sh', `build=${mode}`];

console.log(`[build:wasm] Running on ${os.platform()}... executing ${args[isWin ? 3 : 0]} in ${mode} mode`);

const result = spawnSync(command, args, { stdio: 'inherit' });

process.exit(result.status !== null ? result.status : 1);
