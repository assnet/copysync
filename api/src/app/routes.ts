import { env } from '../shared/config/env';
import { authRoutes } from '../modules/auth/presentation/routes/auth.routes';
import { tenantRoutes } from '../modules/tenants/presentation/routes/tenant.routes';
import { meRoutes } from '../modules/users/presentation/routes/me.routes';
import { sessionRoutes } from '../modules/sessions/presentation/routes/session.routes';
import { chatRoutes } from '../modules/chat/presentation/routes/chat.routes';
import { chatWsRoutes } from '../modules/chat/presentation/routes/chat.ws.routes';
import {
  mediaUploadRoutes,
  type MediaUploadRoutesOptions,
} from '../modules/media/presentation/routes/media.upload.routes';
import { mediaContainer } from '../modules/media/infrastructure/mediaContainer';
import { authHook } from '../shared/http/hooks/authHook';
import { tenantHook } from '../shared/http/hooks/tenantHook';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFastifyInstance = any;

/**
 * Central route registry.
 * Each module registers its own routes here, scoped under the API prefix.
 * Keep this file thin — no business logic.
 */
export async function registerRoutes(app: AnyFastifyInstance): Promise<void> {
  // ── Health check (no auth) ─────────────────────────────────────────────────
  app.get(
    '/health',
    {
      schema: {
        tags: ['Health'],
        summary: 'Healthcheck da API',
        response: {
          200: {
            type: 'object',
            properties: {
              status: { type: 'string', example: 'ok' },
              timestamp: { type: 'string', format: 'date-time' },
              environment: { type: 'string' },
            },
          },
        },
      },
    },
    async (_request: unknown, reply: { send: (payload: unknown) => void }) => {
      reply.send({
        status: 'ok',
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV ?? 'unknown',
      });
    },
  );

  // ── Auth routes (no auth required, except /logout) ─────────────────────────
  await app.register(authRoutes, { prefix: `${env.API_PREFIX}/auth` });

  // ── Tenant routes (auth required, no tenant scope) ─────────────────────────
  await app.register(tenantRoutes, { prefix: `${env.API_PREFIX}/tenants` });

  // ── Me route (auth required, no tenant scope) ──────────────────────────────
  await app.register(meRoutes, { prefix: `${env.API_PREFIX}/me` });

  // ── Session routes (auth + tenant scope required) ──────────────────────────
  await app.register(sessionRoutes, { prefix: `${env.API_PREFIX}/sessions` });

  // ── Chat routes (auth + tenant scope required) ─────────────────────────────
  await app.register(chatRoutes, { prefix: `${env.API_PREFIX}/chat` });

  // ── Chat WebSocket gateway ─────────────────────────────────────────────────
  await app.register(chatWsRoutes, { prefix: `${env.API_PREFIX}/chat` });

  // ── Media upload routes (auth + tenant scope required) ─────────────────────
  // Parser binário encapsulado no plugin; store e capacidades vêm da composição única.
  const mediaUploadOptions: MediaUploadRoutesOptions = {
    store: mediaContainer.uploadStore,
    capabilities: mediaContainer.capabilities,
    settings: env,
    authHooks: [authHook, tenantHook],
  };
  await app.register(mediaUploadRoutes, {
    prefix: `${env.API_PREFIX}/media/uploads`,
    ...mediaUploadOptions,
  });
}
