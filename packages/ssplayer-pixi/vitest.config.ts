import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // `Blob` / `createImageBitmap` and Pixi's own DOM assumptions need a
    // document. Pixi itself is mocked in the tests, so no GL context is.
    environment: 'jsdom',
    include: ['src/**/*.test.ts'],
  },
});
