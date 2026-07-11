// Zero-dependency static file server for the RPG Maker MZ example.
//
// RPG Maker MZ must be served over HTTP (not file://) so it can fetch its
// data/*.json, the ssplayer-rmmz plugin's WASM runtime, and the .ssab assets.
// The game lives in SampleProject/ — index.html is its entry point — so that is
// the served root, and MIME types the runtime needs (notably application/wasm)
// are set here. Kept dep-free on purpose so the example runs with nothing
// installed beyond Node.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Serve the RPG Maker MZ project itself (SampleProject/index.html is the entry),
// not the example wrapper directory.
const root = resolve(fileURLToPath(import.meta.url), '../../SampleProject');
// Distinctive default port: RPG Maker MZ persists save data and config to
// localStorage/IndexedDB, both keyed by ORIGIN (scheme+host+port). Serving on
// our own port gives this example a pristine origin, immune to leftover save or
// config state from another local project sharing a common port (3000/5173/8000).
const port = Number(process.env.PORT ?? 5816);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.ssab': 'application/octet-stream',
  '.ssqb': 'application/octet-stream',
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
  console.log(`[serve] RPG Maker MZ example at http://localhost:${port}/`);
  console.log(`[serve] root: ${root}`);
});
