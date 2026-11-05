import { PrismaClient } from '@prisma/client';
import { env } from '../config/env';
import { logger } from '../logger/logger';
import { buildDatasourceUrl } from './datasourceUrl';

function createPrismaClient(): PrismaClient {
  const datasourceUrl = buildDatasourceUrl(env.DATABASE_URL, env.DATABASE_SOCKET_TIMEOUT_S);
  return new PrismaClient({
    ...(datasourceUrl ? { datasourceUrl } : {}),
    log: [
      { emit: 'event', level: 'query' },
      { emit: 'event', level: 'error' },
      { emit: 'event', level: 'warn' },
    ],
  });
}

const prisma = createPrismaClient();

// Forward Prisma log events to pino — only in development
if (process.env.NODE_ENV !== 'production') {
  (prisma as any).$on('query', (e: { query: string; duration: number }) => {
    logger.debug({ query: e.query, duration: e.duration }, 'prisma:query');
  });
}

(prisma as any).$on('error', (e: { message: string }) => {
  logger.error({ err: e.message }, 'prisma:error');
});

(prisma as any).$on('warn', (e: { message: string }) => {
  logger.warn({ msg: e.message }, 'prisma:warn');
});

export { prisma };
