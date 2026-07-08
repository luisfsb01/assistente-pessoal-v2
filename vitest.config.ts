import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['apps/server/src/**/*.test.ts'],
    setupFiles: ['./apps/server/src/test-setup.ts'],
  },
});
