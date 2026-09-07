import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

/**
 * Vitest da API.
 *
 * Testes ficam co-locados ao código (`Arquivo.test.ts` ao lado de `Arquivo.ts`) — a mesma
 * pasta do módulo, para o teste morrer junto com o código que ele cobre.
 *
 * Escopo: lógica pura e use cases com dependências injetadas (repositórios e engine entram
 * como dublês). Nada aqui sobe Fastify, Prisma ou Baileys — camada de infraestrutura real é
 * validada por smoke manual.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    clearMocks: true,
    restoreMocks: true,
  },
  resolve: {
    alias: {
      '@shared':  resolve(__dirname, 'src/shared'),
      '@modules': resolve(__dirname, 'src/modules'),
      '@app':     resolve(__dirname, 'src/app'),
    },
  },
});
