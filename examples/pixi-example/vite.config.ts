import { defineConfig } from 'vite';
import fs from 'fs';
import path from 'path';

export default defineConfig(() => {
  // package.json から pixi.js のバージョンを動的に取得する
  const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'package.json'), 'utf-8'));
  const rawVersion = (pkg.dependencies && pkg.dependencies['pixi.js']) || 
                     (pkg.devDependencies && pkg.devDependencies['pixi.js']) || 
                     '^8.0.0';
  const pixiVersion = rawVersion.replace(/[\^~]/g, '');

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
      "pixi.js": "https://cdn.jsdelivr.net/npm/pixi.js@${pixiVersion}/+esm"
    }
  }
</script>`
          );
        }
      }
    ]
  };
});
