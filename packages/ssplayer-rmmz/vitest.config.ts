import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // jsdom gives us document/window so the framework-thin helpers (which probe
    // globals like document.currentScript) run without a real MZ/PixiJS runtime.
    environment: 'jsdom',
    include: ['src/**/*.test.ts'],
  },
});
