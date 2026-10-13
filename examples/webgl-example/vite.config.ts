import { defineConfig } from 'vite';
import viteCompression from 'vite-plugin-compression';
import { resolve } from 'node:path';

export default defineConfig({
  build: {
    // Multi-page: without this Vite builds index.html only, so the other demos
    // worked in `vite dev` and then silently vanished from the built output.
    rollupOptions: {
      input: {
        index: resolve(__dirname, 'index.html'),
        element: resolve(__dirname, 'element.html'),
        multi: resolve(__dirname, 'multi.html'),
        blend: resolve(__dirname, 'blend.html'),
      },
    },
    minify: 'terser',
    terserOptions: {
      compress: {
        // console.log only. `drop_console: true` also swallows console.error and
        // console.warn -- including the player's own "failed to load texture" /
        // "failed to load SSAB" reporting, which is exactly what someone whose
        // asset does not show up needs to see. An example that hides the one
        // clue it has is worse than a noisy one. (Array form: terser >= 5.16.)
        drop_console: ['log'],
        drop_debugger: true,
      },
    },
  },
  plugins: [
    viteCompression({ algorithm: 'gzip', filter: /\.(js|mjs|json|css|html|wasm)$/i }),
    viteCompression({ algorithm: 'brotliCompress', ext: '.br', filter: /\.(js|mjs|json|css|html|wasm)$/i }),
  ]
});
