import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // SSSurface branches on `target instanceof HTMLCanvasElement` and reads
    // canvas.width/height, so a DOM is needed. The renderer, the resource manager
    // and the WASM-backed core player are all mocked, so no GL context is.
    environment: 'jsdom',
    include: ['src/**/*.test.ts'],
  },
});
