import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'apps/server/src/**/*.test.ts',
      'apps/web/src/lib/**/*.test.ts', // lógica pura do web (sem DOM)
      'apps/web/src/**/*.test.tsx', // smoke de componentes/rotas via SSR
    ],
  },
});
