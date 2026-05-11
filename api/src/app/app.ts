import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import jwt from '@fastify/jwt';
import websocket from '@fastify/websocket';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import staticPlugin from '@fastify/static';
import path from 'path';
import fs from 'fs/promises';
import { env } from '../shared/config/env';
import { errorHandler } from '../shared/http/errorHandler';
import { registerRoutes } from './routes';

const defaultCorsOrigins = [
  'https://waioprime.com',
  'https://www.waioprime.com',
  'https://waioprime.onrender.com',
];

function normalizeOrigin(origin: string): string {
  return origin.trim().replace(/^['\"]|['\"]$/g, '').replace(/\/+$/, '');
}

function getAllowedCorsOrigins(rawOrigins: string): string[] | null {
  if (rawOrigins.trim() === '*') {
    return null;
  }

  const configuredOrigins = rawOrigins
    .split(',')
    .map(normalizeOrigin)
    .filter(Boolean);

  return Array.from(new Set([...configuredOrigins, ...defaultCorsOrigins]));
}

export async function buildApp() {
  const allowedCorsOrigins = getAllowedCorsOrigins(env.CORS_ORIGIN);

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

  app.log.info(
    { corsOrigins: allowedCorsOrigins ?? ['*'] },
    'CORS origins configured',
  );

  // ── Security plugins ──────────────────────────────────────────────────────
  await app.register(helmet, {
    contentSecurityPolicy: false, // API only, no HTML
  });

  await app.register(cors, {
    origin: (origin, callback) => {
      if (!origin || allowedCorsOrigins === null) {
        callback(null, true);
        return;
      }

      callback(null, allowedCorsOrigins.includes(normalizeOrigin(origin)));
    },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-tenant-id'],
  });

  // ── Authentication plugin ─────────────────────────────────────────────────
  await app.register(jwt, {
    secret: env.JWT_SECRET,
    sign: {
      expiresIn: env.JWT_ACCESS_EXPIRES_IN,
    },
  });

  // ── WebSocket plugin ──────────────────────────────────────────────────────
  await app.register(websocket);

  // ── Static media storage ──────────────────────────────────────────────────
  // Serves uploaded/downloaded media files (images, audio, video, documents)
  // at GET /api/storage/...  No authentication — URLs are opaque and temporary.
  // Creates the directory if it doesn't exist (required on first boot with a
  // fresh persistent disk on Render, otherwise @fastify/static throws ENOENT).
  const storageRoot = path.resolve(env.STORAGE_PATH);
  await fs.mkdir(path.join(storageRoot, 'media'), { recursive: true });
  await app.register(staticPlugin, {
    root: storageRoot,
    prefix: `${env.API_PREFIX}/storage/`,
    decorateReply: false,
    setHeaders(res) {
      // Allow cross-origin loading of media (audio, image, video, document)
      // elements from the panel domain (waioprime.com → api.waioprime.com).
      // Without this, @fastify/helmet's default CORP: same-origin blocks them.
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    },
  });

  // ── OpenAPI / Swagger ─────────────────────────────────────────────────────
  await app.register(swagger, {
    openapi: {
      openapi: '3.0.3',
      info: {
        title: 'WaioPrime API',
        description:
          'API REST para a plataforma WaioPrime — mensageria, CRM, automação e assistentes de IA.',
        version: '0.2.0',
        contact: { name: 'WaioPrime', email: 'dev@waioprime.com' },
      },
      servers: [
        { url: `http://localhost:${env.PORT}`, description: 'Local' },
        { url: 'https://waioprime-api.onrender.com', description: 'Produção' },
      ],
      components: {
        securitySchemes: {
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
            description: 'Access token obtido via `POST /api/auth/login`',
          },
        },
      },
      tags: [
        { name: 'Health', description: 'Status da API' },
        { name: 'Auth', description: 'Autenticação — login, refresh token, logout' },
        { name: 'Tenants', description: 'Tenants do usuário autenticado' },
        { name: 'Me', description: 'Perfil do usuário autenticado' },
        { name: 'Sessions', description: 'Sessões WhatsApp — ciclo de vida, QR code, pairing' },
      ],
    },
  });

  await app.register(swaggerUi, {
    routePrefix: '/docs',
    uiConfig: {
      docExpansion: 'list',
      deepLinking: true,
      persistAuthorization: true,
    },
    staticCSP: false,
  });

  // ── Shared schemas (registrados para validação + serializaçāo + spec) ─────
  // Auth
  app.addSchema({
    $id: 'LoginResponse',
    type: 'object',
    properties: {
      success: { type: 'boolean' },
      data: {
        type: 'object',
        properties: {
          accessToken: { type: 'string' },
          refreshToken: { type: 'string' },
          user: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              name: { type: 'string' },
              email: { type: 'string' },
              isSuperAdmin: { type: 'boolean' },
            },
          },
          tenants: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                name: { type: 'string' },
                slug: { type: 'string' },
                role: { type: 'string' },
              },
            },
          },
        },
      },
    },
  });

  // Tenants
  app.addSchema({
    $id: 'TenantItem',
    type: 'object',
    properties: {
      id: { type: 'string' },
      name: { type: 'string' },
      slug: { type: 'string' },
      role: { type: 'string', enum: ['OWNER', 'ADMIN', 'MEMBER', 'SUPER_ADMIN'] },
      status: { type: 'string' },
    },
  });

  // Sessions
  app.addSchema({
    $id: 'SessionStatus',
    type: 'string',
    enum: ['PENDING', 'CONNECTING', 'AWAITING_QR', 'AWAITING_PAIRING', 'CONNECTED', 'DISCONNECTED', 'LOGGED_OUT', 'FAILED'],
  });

  app.addSchema({
    $id: 'SessionItem',
    type: 'object',
    properties: {
      id: { type: 'string' },
      tenantId: { type: 'string' },
      name: { type: 'string' },
      engine: { type: 'string' },
      phone: { type: 'string', nullable: true },
      externalRef: { type: 'string', nullable: true },
      status: { $ref: 'SessionStatus#' },
      lastConnectedAt: { type: 'string', format: 'date-time', nullable: true },
      lastDisconnectedAt: { type: 'string', format: 'date-time', nullable: true },
      lastSeenAt: { type: 'string', format: 'date-time', nullable: true },
      createdAt: { type: 'string', format: 'date-time' },
      updatedAt: { type: 'string', format: 'date-time' },
    },
  });

  // Errors
  app.addSchema({
    $id: 'ErrorResponse',
    type: 'object',
    properties: {
      success: { type: 'boolean' },
      error: {
        type: 'object',
        properties: {
          code: { type: 'string' },
          message: { type: 'string' },
        },
      },
    },
  });

  // ── Global error handler ──────────────────────────────────────────────────
  // Cast required: Fastify type widens after plugin registration
  app.setErrorHandler(errorHandler as Parameters<typeof app.setErrorHandler>[0]);

  // ── Routes ────────────────────────────────────────────────────────────────
  await registerRoutes(app);

  return app;
}
