import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // The tags manipulate the DOM (layer divs, <canvas> insertion), so we need a
    // browser-like environment. The real SSPlayer (WebGL) is mocked, so no
    // GL context is required.
    environment: 'jsdom',
    include: ['src/**/*.test.ts'],
  },
});
