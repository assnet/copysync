import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import jwt from '@fastify/jwt';
import websocket from '@fastify/websocket';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import rateLimit from '@fastify/rate-limit';
import staticPlugin from '@fastify/static';
import path from 'path';
import fs from 'fs/promises';
import { env } from '../shared/config/env';
import { errorHandler } from '../shared/http/errorHandler';
import { contentDispositionFor, contentDispositionHeader, isAllowedMediaPath } from '../shared/storage/staticMediaPolicy';
import { registerRoutes } from './routes';
import { affiliateCredentialItemSchema } from '../modules/integrations/presentation/schemas/affiliateCredential.schema';

function normalizeOrigin(origin: string): string {
  return origin.trim().replace(/^['\"]|['\"]$/g, '').replace(/\/+$/, '');
}

function getAllowedCorsOrigins(): string[] {
  const list: string[] = [];

  if (env.CORS_ORIGIN) {
    for (const o of env.CORS_ORIGIN.split(',')) {
      const n = normalizeOrigin(o);
      if (n) list.push(n);
    }
  }

  if (env.PANEL_ORIGIN) list.push(env.PANEL_ORIGIN);

  for (const ext of env.EXTENSION_ORIGINS_LIST) {
    if (ext) list.push(ext);
  }

  if (env.NODE_ENV !== 'production' && list.length === 0) {
    list.push('http://localhost:5174', 'http://localhost:3333');
  }

  return [...new Set(list)];
}

export async function buildApp() {
  const allowedCorsOrigins = getAllowedCorsOrigins();

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
    trustProxy: 1, // single trusted hop (Render proxy)
  });

  app.log.info(
    { corsOrigins: allowedCorsOrigins },
    'CORS origins configured',
  );

  // ── Security plugins ──────────────────────────────────────────────────────
  await app.register(helmet, {
    contentSecurityPolicy: false, // API only, no HTML
  });

  await app.register(cors, {
    origin: (origin, callback) => {
      if (!origin) { callback(null, true); return; }
      callback(null, allowedCorsOrigins.includes(normalizeOrigin(origin)));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-tenant-id', 'x-client', 'x-installation-id'],
  });

  // ── Rate limiting ────────────────────────────────────────────────────────
  await app.register(rateLimit, {
    max: 120,
    timeWindow: '1 minute',
    keyGenerator: (request) => request.ip,
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
    // O plugin troca o padrão do send para 'allow'; a raiz guarda pastas ocultas (uploads).
    dotfiles: 'deny',
    // Só media/, já normalizado: o que estiver fora da pasta responde 404.
    allowedPath: isAllowedMediaPath,
    setHeaders(res, filePath) {
      // Allow cross-origin loading of media (audio, image, video, document)
      // elements from the panel domain.
      // Without this, @fastify/helmet's default CORP: same-origin blocks them.
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
      // Imagem/áudio/vídeo/PDF seguem inline como antes; svg/html/xml aberto na aba
      // rodaria script na origem da API, então baixa. O nosniff já vem do helmet.
      res.setHeader('Content-Disposition', contentDispositionFor(path.extname(filePath)));
    },
  });
  // `?name=` põe o nome original no download: link cross-origin ignora o atributo `download`
  // do painel. O `setHeaders` do plugin não vê a requisição, por isso o hook vem aqui.
  const storagePrefix = `${env.API_PREFIX}/storage/`;
  app.addHook('onSend', async (request, reply) => {
    if (!request.url.startsWith(storagePrefix)) return;
    const name = (request.query as Record<string, unknown> | undefined)?.name;
    if (typeof name !== 'string' || !name) return;
    const ext = path.extname(request.url.split('?')[0]);
    reply.header('Content-Disposition', contentDispositionHeader(ext, name));
  });

  // ── OpenAPI / Swagger ─────────────────────────────────────────────────────
  await app.register(swagger, {
    openapi: {
      openapi: '3.0.3',
      info: {
        title: 'CopySync API',
        description:
          'API REST para a plataforma CopySync — mensageria, CRM, automação e assistentes de IA.',
        version: '0.24.0',
        contact: { name: 'CopySync', email: 'dev@copysync.app' },
      },
      servers: [
        { url: `http://localhost:${env.PORT}`, description: 'Local' },
        { url: 'https://api.copysync.app', description: 'Produção' },
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
        { name: 'Integrations', description: 'Credenciais de afiliado por marketplace' },
        { name: 'Offers', description: 'Gerador de ofertas — link do produto, edição e envio' },
        { name: 'AI', description: 'Provedores de IA da plataforma e chave própria do tenant' },
        { name: 'Extension', description: 'Extensão de navegador — sessão, heartbeat, ciclo de vida' },
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
      declaredPhone: { type: 'string', nullable: true },
      phoneMismatch: { type: 'boolean' },
      externalRef: { type: 'string', nullable: true },
      status: { $ref: 'SessionStatus#' },
      lastConnectedAt: { type: 'string', format: 'date-time', nullable: true },
      lastDisconnectedAt: { type: 'string', format: 'date-time', nullable: true },
      lastSeenAt: { type: 'string', format: 'date-time', nullable: true },
      // Foto do número conectado. Sem declarar aqui, o serializer do Fastify
      // descarta o campo silenciosamente, mesmo o presenter devolvendo-o.
      avatarUrl: { type: 'string', nullable: true },
      createdAt: { type: 'string', format: 'date-time' },
      updatedAt: { type: 'string', format: 'date-time' },
    },
  });

  app.addSchema(affiliateCredentialItemSchema);

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
          // Ex.: { field } em 422 — sem declarar, o serializer descarta.
          meta: { type: 'object', additionalProperties: true },
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
