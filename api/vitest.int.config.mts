import { defineConfig } from 'vitest/config';

/**
 * Testes de integração da API (`*.int.test.ts`): repositórios Prisma contra um Postgres LOCAL
 * descartável (`scripts/postgres-descartavel.sh start`). Fora do `pnpm test` (sem banco) e fora do CI.
 *
 *   INTEGRATION_DATABASE_URL=postgresql://postgres@127.0.0.1:55432/copysync_int pnpm test:int
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.int.test.ts'],
    setupFiles: ['src/test/setup.int.ts'],
    fileParallelism: false,
    clearMocks: true,
    restoreMocks: true,
  },
});
