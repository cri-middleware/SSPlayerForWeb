import { defineConfig } from 'vite';
import viteCompression from 'vite-plugin-compression';

// Mirrors examples/webgl-example/vite.config.ts. The one difference is what
// this example ships: the converter's 1.6 MB wasm is an asset here, so the
// gzip/brotli filters below matter more than they do elsewhere — and the page
// only fetches it when the reader actually drops a project.
export default defineConfig({
  build: {
    minify: 'terser',
    terserOptions: {
      compress: {
        // console.log only. `drop_console: true` also swallows console.error
        // and console.warn — including the player's own "failed to load
        // texture" reporting, which is exactly what someone whose asset does
        // not show up needs to see.
        drop_console: ['log'],
        drop_debugger: true,
      },
    },
  },
  plugins: [
    viteCompression({ algorithm: 'gzip', filter: /\.(js|mjs|json|css|html|wasm)$/i }),
    viteCompression({ algorithm: 'brotliCompress', ext: '.br', filter: /\.(js|mjs|json|css|html|wasm)$/i }),
  ],
});
