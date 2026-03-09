import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import jwt from '@fastify/jwt';
import '../shared/types/fastify.d'; // activate type augmentation
import { env } from '../shared/config/env';
import { errorHandler } from '../shared/http/errorHandler';
import { registerRoutes } from './routes';

export async function buildApp() {
  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      ...(env.LOG_PRETTY
        ? {
            transport: {
              target: 'pino-pretty',
              options: {
                colorize: true,
                translateTime: 'SYS:standard',
                ignore: 'pid,hostname',
              },
            },
          }
        : {
            formatters: { level: (label: string) => ({ level: label }) },
          }),
    },
    disableRequestLogging: false,
    trustProxy: true, // required for correct IPs behind Render's proxy
  });

  // ── Security plugins ──────────────────────────────────────────────────────
  await app.register(helmet, {
    contentSecurityPolicy: false, // API only, no HTML
  });

  await app.register(cors, {
    origin: env.CORS_ORIGIN === '*' ? true : env.CORS_ORIGIN.split(','),
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  // ── Authentication plugin ─────────────────────────────────────────────────
  await app.register(jwt, {
    secret: env.JWT_SECRET,
    sign: {
      expiresIn: env.JWT_ACCESS_EXPIRES_IN,
    },
  });

  // ── Global error handler ──────────────────────────────────────────────────
  // Cast required: Fastify type widens after plugin registration
  app.setErrorHandler(errorHandler as Parameters<typeof app.setErrorHandler>[0]);

  // ── Routes ────────────────────────────────────────────────────────────────
  await registerRoutes(app);

  return app;
}
