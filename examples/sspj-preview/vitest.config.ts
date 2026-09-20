import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // The timeline is DOM: markers, rows and a range input. Everything it
    // drives is mocked (the player has no GL context here), so jsdom is
    // enough — the same shape as packages/ssplayer-webgl's own config.
    environment: 'jsdom',
    include: ['src/**/*.test.ts'],
  },
});
