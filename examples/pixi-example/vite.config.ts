import { defineConfig } from 'vite';
import fs from 'fs';
import path from 'path';
import viteCompression from 'vite-plugin-compression';

export default defineConfig(() => {
  // package.json から pixi.js のバージョンを動的に取得する
  const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'package.json'), 'utf-8'));
  const rawVersion = (pkg.dependencies && pkg.dependencies['pixi.js']) || 
                     (pkg.devDependencies && pkg.devDependencies['pixi.js']) || 
                     '^8.0.0';
  const pixiVersion = rawVersion.replace(/[\^~]/g, '');
  const pixiUrl = `https://cdn.jsdelivr.net/npm/pixi.js@${pixiVersion}/+esm`;

  return {
    build: {
      minify: 'terser',
      terserOptions: {
        compress: {
          drop_console: true,
          drop_debugger: true,
        },
      },
    },
    plugins: [
      viteCompression({ algorithm: 'gzip', filter: /\.(js|mjs|json|css|html|wasm)$/i }),
      viteCompression({ algorithm: 'brotliCompress', ext: '.br', filter: /\.(js|mjs|json|css|html|wasm)$/i }),
      {
        name: 'externalize-pixi',
        enforce: 'pre',
        resolveId(source) {
          if (source === 'pixi.js') {
            return { id: 'pixi.js', external: true };
          }
        },
        transformIndexHtml(html) {
          return html.replace(
            '<!-- PIXI_IMPORT_MAP -->',
            `<script type="importmap">
  {
    "imports": {
      "pixi.js": "${pixiUrl}"
    }
  }
</script>
    <link rel="modulepreload" href="${pixiUrl}">`
          );
        }
      }
    ]
  };
});
