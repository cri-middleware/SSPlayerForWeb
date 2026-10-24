import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Pixi's event and accessibility code expects a document.
    environment: 'jsdom',
    include: ['src/**/*.test.ts'],
  },
});
