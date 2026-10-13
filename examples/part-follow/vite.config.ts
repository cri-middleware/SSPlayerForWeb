import { defineConfig } from 'vite';
import fs from 'fs';
import path from 'path';
import viteCompression from 'vite-plugin-compression';

// Mirrors examples/override-example/vite.config.ts: pixi.js is loaded from a CDN
// via an import map in the built page (kept out of the bundle), while `vite dev`
// resolves it from node_modules as usual.
export default defineConfig(({ command }) => {
  const pkg = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, 'package.json'), 'utf-8'));
  const rawVersion = (pkg.dependencies && pkg.dependencies['pixi.js']) ||
                     (pkg.devDependencies && pkg.devDependencies['pixi.js']) ||
                     '^8.0.0';
  const pixiVersion = rawVersion.replace(/[\^~]/g, '');
  // pixi's OWN prebuilt ESM, not jsdelivr's `/+esm` — see the same line in
  // pixi-example/vite.config.ts: the `/+esm` re-bundle silently draws nothing.
  const pixiUrl = `https://cdn.jsdelivr.net/npm/pixi.js@${pixiVersion}/dist/pixi.mjs`;

  return {
    build: {
      minify: 'terser',
      terserOptions: {
        compress: {
          // console.log only -- see the same block in pixi-example: dropping
          // console.error/warn hides the player's own asset-loading failures.
          drop_console: ['log'],
          drop_debugger: true,
        },
      },
      rollupOptions: {
        external: ['pixi.js'],
      }
    },
    plugins: [
      viteCompression({ algorithm: 'gzip', filter: /\.(js|mjs|json|css|html|wasm)$/i }),
      viteCompression({ algorithm: 'brotliCompress', ext: '.br', filter: /\.(js|mjs|json|css|html|wasm)$/i }),
      {
        name: 'externalize-pixi',
        enforce: 'pre',
        transformIndexHtml(html) {
          if (command === 'build') {
            return html.replace(
              '<!-- PIXI_IMPORT_MAP -->',
              `<script type="importmap">\n  {\n    "imports": {\n      "pixi.js": "${pixiUrl}"\n    }\n  }\n</script>\n    <link rel="modulepreload" href="${pixiUrl}">`
            );
          }
          return html;
        }
      }
    ]
  };
});
