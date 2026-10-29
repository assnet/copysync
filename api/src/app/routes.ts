import { env } from '../shared/config/env';
import { authRoutes } from '../modules/auth/presentation/routes/auth.routes';
import { inviteRoutes } from '../modules/auth/presentation/routes/invite.routes';
import { tenantRoutes } from '../modules/tenants/presentation/routes/tenant.routes';
import { meRoutes } from '../modules/users/presentation/routes/me.routes';
import { sessionRoutes } from '../modules/sessions/presentation/routes/session.routes';
import { chatRoutes } from '../modules/chat/presentation/routes/chat.routes';
import { chatWsRoutes } from '../modules/chat/presentation/routes/chat.ws.routes';
import {
  mediaUploadRoutes,
  type MediaUploadRoutesOptions,
} from '../modules/media/presentation/routes/media.upload.routes';
import { affiliateCredentialRoutes } from '../modules/integrations/presentation/routes/affiliateCredential.routes';
import { offerRoutes } from '../modules/campaigns/presentation/routes/offer.routes';
import { sendQueueRoutes } from '../modules/campaigns/presentation/routes/sendQueue.routes';
import { groupMonitoringRoutes } from '../modules/automation/presentation/routes/groupMonitoring.routes';
import { provisioningRoutes } from '../modules/tenants/presentation/routes/provisioning.routes';
import { aiAdminRoutes, aiTenantRoutes } from '../modules/assistants/presentation/routes/ai.routes';
import { billingRoutes } from '../modules/integrations/billing/billing.routes';
import { extensionRoutes } from '../modules/extension/presentation/routes/extension.routes';
import { linkRotationRoutes } from '../modules/link-rotation/presentation/routes/linkRotation.routes';
import { linkDomainAdminRoutes } from '../modules/link-rotation/presentation/routes/linkDomainAdmin.routes';
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

  // ── Invite routes (public, optional auth on accept) ────────────────────────
  await app.register(inviteRoutes, { prefix: `${env.API_PREFIX}/auth` });

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

  // ── Integration routes (auth + tenant scope required) ──────────────────────
  await app.register(affiliateCredentialRoutes, {
    prefix: `${env.API_PREFIX}/integrations/affiliate-credentials`,
  });

  // ── Gerador de ofertas (auth + tenant scope required) ──────────────────────
  await app.register(offerRoutes, { prefix: `${env.API_PREFIX}/campaigns/offers` });
  await app.register(sendQueueRoutes, { prefix: `${env.API_PREFIX}/campaigns/send-queue` });
  await app.register(groupMonitoringRoutes, { prefix: `${env.API_PREFIX}/automation/group-monitoring` });

  // ── Provisioning routes (super-admin only) ─────────────────────────────────
  await app.register(provisioningRoutes, {
    prefix: `${env.API_PREFIX}/provisioning`,
  });

  // ── IA: provedores da plataforma (super admin) e chave própria do tenant ────
  await app.register(aiAdminRoutes, { prefix: `${env.API_PREFIX}/admin/ai` });
  await app.register(aiTenantRoutes, { prefix: `${env.API_PREFIX}/ai` });

  // ── Rodízio de links: painel do tenant e domínios (super admin) ─────────────
  await app.register(linkRotationRoutes, { prefix: `${env.API_PREFIX}/link-rotation` });
  await app.register(linkDomainAdminRoutes, { prefix: `${env.API_PREFIX}/admin/link-domains` });

  // ── Billing webhook (HMAC-authenticated, no authHook) ──────────────────────
  if (env.BILLING_ENABLED) {
    await app.register(billingRoutes, {
      prefix: `${env.API_PREFIX}/integrations/billing`,
    });
  }

  // ── Extension routes (mixed auth: Bearer + cookie) ────────────────────────
  await app.register(extensionRoutes, {
    prefix: `${env.API_PREFIX}/extension`,
  });

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
