import { defineConfig } from 'vite';
import fs from 'fs';
import path from 'path';
import viteCompression from 'vite-plugin-compression';

export default defineConfig(({ command }) => {
  const pkg = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, 'package.json'), 'utf-8'));
  const rawVersion = (pkg.dependencies && pkg.dependencies['pixi.js']) || 
                     (pkg.devDependencies && pkg.devDependencies['pixi.js']) || 
                     '^8.0.0';
  const pixiVersion = rawVersion.replace(/[\^~]/g, '');
  // pixi's OWN prebuilt ESM, not jsdelivr's `/+esm`. `/+esm` is jsdelivr
  // re-bundling the package itself, and that re-bundle drops render-pipe
  // registrations PixiJS performs as module side effects: the scene graph, the
  // textures and the ticker all look correct, `renderer.render()` runs every
  // frame, and not one pixel is drawn — with no error anywhere. `dist/pixi.mjs`
  // is what the package ships and is what CDN consumers should load.
  const pixiUrl = `https://cdn.jsdelivr.net/npm/pixi.js@${pixiVersion}/dist/pixi.mjs`;

  return {
    build: {
      minify: 'terser',
      terserOptions: {
        compress: {
          // console.log only. `drop_console: true` also swallows console.error
          // and console.warn -- including PixiResourceManager's "Failed to load
          // texture", which is exactly what someone whose asset does not show up
          // needs to see. An example that hides the one clue it has is worse
          // than a noisy one. (Array form: terser >= 5.16.)
          drop_console: ['log'],
          drop_debugger: true,
        },
      },
      rollupOptions: {
        // Multi-page: without this Vite builds index.html only, so blend.html
        // works in `vite dev` and then vanishes from the built output.
        input: {
          index: path.resolve(import.meta.dirname, 'index.html'),
          blend: path.resolve(import.meta.dirname, 'blend.html'),
          ui: path.resolve(import.meta.dirname, 'ui.html'),
        },
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
