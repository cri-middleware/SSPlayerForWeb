#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');

const HELP = `Build a Google Ads HTML5 ad from one .ssab: index.html and ad.js, and a ZIP of the two.

Usage:
  node examples/html5-ad/build.mjs ssab=<file.ssab> [animation=<name>] [size=<W>x<H>] [out=<dir>]
                                   [player=<ssplayer-webgl.browser.min.js>] [wasm=<ssruntime_bg.wasm>]

  ssab       an .ssab converted with its textures embedded (--embedded)
  animation  the animation to loop (default: the first in the pack)
  size       the ad slot in CSS pixels (default: 300x250)
  out        where the bundle goes (default: examples/html5-ad/out)
  player     the browser bundle of @spritestudio/ssplayer-webgl
             (default: packages/ssplayer-webgl/dist/browser/ssplayer-webgl.browser.min.js)
  wasm       the runtime it was built against
             (default: packages/ssplayer-core/wasm/ssruntime_bg.wasm)

Writes <out>/<name>/index.html, <out>/<name>/ad.js and <out>/<name>.zip, <name> being the .ssab's.
`;

function fail(message, code = 1) {
  process.stderr.write(`build.mjs: ${message}\n`);
  process.exit(code);
}

const opts = {
  animation: '',
  size: '300x250',
  out: path.join(HERE, 'out'),
  player: path.join(ROOT, 'packages/ssplayer-webgl/dist/browser/ssplayer-webgl.browser.min.js'),
  wasm: path.join(ROOT, 'packages/ssplayer-core/wasm/ssruntime_bg.wasm'),
};
const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
  process.stdout.write(HELP);
  process.exit(0);
}
for (const arg of args) {
  const eq = arg.indexOf('=');
  const key = eq > 0 ? arg.slice(0, eq) : '';
  if (!['ssab', ...Object.keys(opts)].includes(key)) fail(`unknown argument "${arg}" (see --help)`, 2);
  opts[key] = arg.slice(eq + 1);
}
if (!opts.ssab) fail('ssab=<file.ssab> is required (see --help)', 2);
const size = /^(\d+)x(\d+)$/.exec(opts.size);
if (!size) fail(`size must be <W>x<H>, got "${opts.size}"`, 2);
const [width, height] = [Number(size[1]), Number(size[2])];

function read(file, hint) {
  if (!fs.existsSync(file)) fail(`${file} not found${hint ? ` — ${hint}` : ''}`);
  return fs.readFileSync(file);
}
const built = 'build the packages first: pnpm run build:wasm && pnpm run build';
const player = read(opts.player, built);
const wasm = read(opts.wasm, built);
const ssab = read(opts.ssab);

const boot = `
;(function () {
  var WASM = ${JSON.stringify(wasm.toString('base64'))};
  var SSAB = ${JSON.stringify(ssab.toString('base64'))};
  function bytes(base64) {
    var s = atob(base64), n = s.length, u = new Uint8Array(n);
    for (var i = 0; i < n; i++) u[i] = s.charCodeAt(i);
    return u;
  }
  var P = window.SSWebGLPlayer;
  P.SSSurface.initialize(bytes(WASM)).then(function () {
    var surface = new P.SSSurface(document.getElementById('ss'), { autoStart: true });
    surface.resize(${width}, ${height});
    var player = surface.createPlayer();
    return player.loadBuffer(bytes(SSAB), new Map()).then(function () {
      player.setAnimation(${JSON.stringify(opts.animation)} || player.getAnimationNames()[0]);
      player.setPlacement({});
      player.play();
    });
  }).catch(function (e) { console.error('[html5-ad]', e); });
})();
`;

const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="ad.size" content="width=${width},height=${height}">
<script src="https://tpc.googlesyndication.com/pagead/gadgets/html5/api/exitapi.js"></script>
<style>html,body{margin:0;padding:0;overflow:hidden}#ss{display:block;width:${width}px;height:${height}px;cursor:pointer}</style>
</head>
<body>
<canvas id="ss" width="${width}" height="${height}" onclick="ExitApi.exit()"></canvas>
<script src="ad.js"></script>
</body>
</html>
`;

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function zip(files) {
  const locals = [];
  const central = [];
  let offset = 0;
  for (const [name, data] of files) {
    const nameBytes = Buffer.from(name);
    const packed = zlib.deflateRawSync(data, { level: 9 });
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(0x21, 12); // 1980-01-01, so the same input gives the same ZIP
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(8, 10);
    entry.writeUInt16LE(0x21, 14);
    entry.writeUInt32LE(crc, 16);
    entry.writeUInt32LE(packed.length, 20);
    entry.writeUInt32LE(data.length, 24);
    entry.writeUInt16LE(nameBytes.length, 28);
    entry.writeUInt32LE(offset, 42);
    locals.push(local, nameBytes, packed);
    central.push(entry, nameBytes);
    offset += local.length + nameBytes.length + packed.length;
  }
  const dir = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(dir.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, dir, end]);
}

const name = path.basename(opts.ssab, path.extname(opts.ssab));
const dir = path.join(opts.out, name);
const files = [
  ['index.html', Buffer.from(html)],
  ['ad.js', Buffer.concat([player, Buffer.from(boot)])],
];
fs.mkdirSync(dir, { recursive: true });
for (const [file, data] of files) fs.writeFileSync(path.join(dir, file), data);
const archive = zip(files);
const zipPath = path.join(opts.out, `${name}.zip`);
fs.writeFileSync(zipPath, archive);

const kb = (n) => `${(n / 1000).toFixed(1)} KB`;
process.stdout.write(`${path.relative(process.cwd(), dir)}/  index.html ${kb(files[0][1].length)}, ad.js ${kb(files[1][1].length)}\n`);
process.stdout.write(`${path.relative(process.cwd(), zipPath)}  ${kb(archive.length)}\n`);
