import { defineConfig } from 'vitest/config';

/**
 * Testes de integração da API, fora do `pnpm test` e do CI. Dois projetos:
 *
 * - `db` (`*.int.test.ts`): repositórios Prisma contra um Postgres LOCAL descartável
 *   (`scripts/postgres-descartavel.sh start`); `setup.int.ts` exige INTEGRATION_DATABASE_URL em localhost.
 * - `redis` (`*.redis.int.test.ts`): só Redis LOCAL (`scripts/redis-descartavel.sh start`), sem banco;
 *   sem INTEGRATION_REDIS_URL os arquivos são pulados.
 *
 *   INTEGRATION_DATABASE_URL=postgresql://postgres@127.0.0.1:55432/copysync_int pnpm test:int
 *   INTEGRATION_REDIS_URL=redis://127.0.0.1:56379 pnpm test:int:redis
 */
export default defineConfig({
  test: {
    environment: 'node',
    fileParallelism: false,
    clearMocks: true,
    restoreMocks: true,
    projects: [
      {
        extends: true,
        test: {
          name: 'redis',
          // projetos em sequência (não em paralelo): testes de prazo do BullMQ são sensíveis a CPU
          sequence: { groupOrder: 0 },
          include: ['src/**/*.redis.int.test.ts'],
          setupFiles: ['src/test/setup.redis.int.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'db',
          sequence: { groupOrder: 1 },
          include: ['src/**/*.int.test.ts'],
          exclude: ['**/node_modules/**', 'src/**/*.redis.int.test.ts'],
          setupFiles: ['src/test/setup.int.ts'],
        },
      },
    ],
  },
});
