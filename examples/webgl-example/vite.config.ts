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
      },
    },
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
  ]
});
