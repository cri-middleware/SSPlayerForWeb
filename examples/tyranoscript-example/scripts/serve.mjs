// Zero-dependency static file server for the TyranoScript example.
//
// TyranoScript must be served over HTTP (not file://) so it can fetch the WASM
// runtime and .ssab assets. This serves the example root — index.html + tyrano/
// (fetched at dev-time) + data/ — with the MIME types the runtime needs
// (notably application/wasm). Kept dep-free on purpose so the example runs with
// nothing installed beyond Node.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(import.meta.url), '../..');
// Distinctive default port: localStorage AND service workers are keyed by ORIGIN
// (scheme+host+port). TyranoScript stashes system data in localStorage under
// `<projectID>_sf`; a stale/corrupt value there (e.g. the literal "null", left by
// another tyrano project sharing a common port like 3000/8000) makes the engine
// crash in init_game reading `_system_config_bgm_volume`. Serving on our own port
// gives this example a pristine origin, immune to other projects' leftover state.
const port = Number(process.env.PORT ?? 5847);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.ssab': 'application/octet-stream',
  '.ssqb': 'application/octet-stream',
  '.ks': 'text/plain; charset=utf-8',
  '.tjs': 'text/plain; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ogg': 'audio/ogg',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
};

const server = createServer(async (req, res) => {
  try {
    const urlPath = decodeURIComponent((req.url ?? '/').split('?')[0]);
    // Contain the served path inside root (no path traversal).
    let filePath = normalize(join(root, urlPath));
    if (!filePath.startsWith(root)) {
      res.writeHead(403).end('Forbidden');
      return;
    }
    let info;
    try {
      info = await stat(filePath);
    } catch {
      res.writeHead(404).end('Not found');
      return;
    }
    if (info.isDirectory()) filePath = join(filePath, 'index.html');
    const body = await readFile(filePath);
    res.writeHead(200, {
      'Content-Type': MIME[extname(filePath).toLowerCase()] ?? 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(body);
  } catch (err) {
    res.writeHead(500).end(`Server error: ${err?.message ?? err}`);
  }
});

server.listen(port, () => {
  console.log(`[serve] TyranoScript example at http://localhost:${port}/`);
  console.log(`[serve] root: ${root}`);
});
