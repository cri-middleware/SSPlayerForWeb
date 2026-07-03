import { defineConfig } from 'vite';
import viteCompression from 'vite-plugin-compression';

export default defineConfig({
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
  ]
});
