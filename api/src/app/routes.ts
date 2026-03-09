import { env } from '../shared/config/env';
import { authRoutes } from '../modules/auth/presentation/routes/auth.routes';
import { tenantRoutes } from '../modules/tenants/presentation/routes/tenant.routes';
import { meRoutes } from '../modules/users/presentation/routes/me.routes';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFastifyInstance = any;

/**
 * Central route registry.
 * Each module registers its own routes here, scoped under the API prefix.
 * Keep this file thin — no business logic.
 */
export async function registerRoutes(app: AnyFastifyInstance): Promise<void> {
  // ── Health check (no auth) ─────────────────────────────────────────────────
  app.get('/health', async (_request: unknown, reply: { send: (payload: unknown) => void }) => {
    reply.send({
      status: 'ok',
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV ?? 'unknown',
    });
  });

  // ── Auth routes (no auth required, except /logout) ─────────────────────────
  await app.register(authRoutes, { prefix: `${env.API_PREFIX}/auth` });

  // ── Tenant routes (auth required, no tenant scope) ─────────────────────────
  await app.register(tenantRoutes, { prefix: `${env.API_PREFIX}/tenants` });

  // ── Me route (auth required, no tenant scope) ──────────────────────────────
  await app.register(meRoutes, { prefix: `${env.API_PREFIX}/me` });

  // Future modules:
  // await app.register(sessionRoutes,  { prefix: `${env.API_PREFIX}/sessions` });
  // await app.register(messageRoutes,  { prefix: `${env.API_PREFIX}/messages` });
  // await app.register(contactRoutes,  { prefix: `${env.API_PREFIX}/contacts` });
}
