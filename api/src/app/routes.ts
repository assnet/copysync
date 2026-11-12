import { env } from '../shared/config/env';
import { currentRole } from '../shared/config/processRole';
import { logger } from '../shared/logger/logger';
import { relayHealth } from './roleComposition';
import { authRoutes } from '../modules/auth/presentation/routes/auth.routes';
import { inviteRoutes } from '../modules/auth/presentation/routes/invite.routes';
import { tenantRoutes } from '../modules/tenants/presentation/routes/tenant.routes';
import { subscriptionRoutes } from '../modules/tenants/presentation/routes/subscription.routes';
import { meRoutes } from '../modules/users/presentation/routes/me.routes';
import { sessionRoutes } from '../modules/sessions/presentation/routes/session.routes';
import { workerAdminRoutes } from '../modules/sessions/presentation/routes/workerAdmin.routes';
import { opsMetricsRoutes } from '../modules/metrics/presentation/routes/opsMetrics.routes';
import { infraCostsRoutes } from '../modules/metrics/presentation/routes/infraCosts.routes';
import { planEntitlementAdminRoutes } from '../modules/tenants/presentation/routes/planEntitlementAdmin.routes';
import { chatRoutes } from '../modules/chat/presentation/routes/chat.routes';
import { chatWsRoutes } from '../modules/chat/presentation/routes/chat.ws.routes';
import {
  mediaUploadRoutes,
  type MediaUploadRoutesOptions,
} from '../modules/media/presentation/routes/media.upload.routes';
import { affiliateCredentialRoutes } from '../modules/integrations/presentation/routes/affiliateCredential.routes';
import { marketplaceRiskAdminRoutes } from '../modules/integrations/presentation/routes/marketplaceRiskAdmin.routes';
import { offerRoutes } from '../modules/campaigns/presentation/routes/offer.routes';
import { sendQueueRoutes } from '../modules/campaigns/presentation/routes/sendQueue.routes';
import { broadcastGroupsRoutes } from '../modules/campaigns/presentation/routes/broadcastGroups.routes';
import { groupMonitoringRoutes } from '../modules/automation/presentation/routes/groupMonitoring.routes';
import { provisioningRoutes } from '../modules/tenants/presentation/routes/provisioning.routes';
import { aiAdminRoutes, aiTenantRoutes } from '../modules/assistants/presentation/routes/ai.routes';
import { billingRoutes } from '../modules/integrations/billing/billing.routes';
import { billingWebhookBlockReason } from '../modules/integrations/billing/billingWebhookGuard';
import { extensionRoutes } from '../modules/extension/presentation/routes/extension.routes';
import { linkRotationRoutes } from '../modules/link-rotation/presentation/routes/linkRotation.routes';
import { linkDomainAdminRoutes } from '../modules/link-rotation/presentation/routes/linkDomainAdmin.routes';
import { storefrontRoutes } from '../modules/storefront/presentation/routes/storefront.routes';
import { redirectLinkAdminRoutes } from '../modules/redirect-links/presentation/routes/redirectLinkAdmin.routes';
import { publicRedirectRoutes } from '../modules/redirect-links/presentation/routes/publicRedirect.routes';
import { offerStoryRoutes } from '../modules/offer-story/presentation/routes/offerStory.routes';
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
              role: { type: 'string', enum: ['http', 'worker', 'all'] },
              // Só no `http`: assinatura dos eventos de WS vindos do worker.
              relay: { type: 'string', enum: ['up', 'down'] },
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
        role: currentRole(),
        relay: relayHealth(),
      });
    },
  );

  // ── Auth routes (no auth required, except /logout) ─────────────────────────
  await app.register(authRoutes, { prefix: `${env.API_PREFIX}/auth` });

  // ── Invite routes (public, optional auth on accept) ────────────────────────
  await app.register(inviteRoutes, { prefix: `${env.API_PREFIX}/auth` });

  // ── Tenant routes (auth required, no tenant scope) ─────────────────────────
  await app.register(tenantRoutes, { prefix: `${env.API_PREFIX}/tenants` });

  // ── Assinatura (auth + tenant em qualquer status: tenant suspenso vê o plano) ──
  await app.register(subscriptionRoutes, { prefix: `${env.API_PREFIX}/subscription` });

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
  await app.register(marketplaceRiskAdminRoutes, { prefix: `${env.API_PREFIX}/admin/tenants` });

  // ── Gerador de ofertas (auth + tenant scope required) ──────────────────────
  await app.register(offerRoutes, { prefix: `${env.API_PREFIX}/campaigns/offers` });
  await app.register(sendQueueRoutes, { prefix: `${env.API_PREFIX}/campaigns/send-queue` });
  await app.register(broadcastGroupsRoutes, { prefix: `${env.API_PREFIX}/campaigns/broadcast-groups` });
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

  // ── Workers de sessão: ocupação e aguardando capacidade (super admin) ──────
  await app.register(workerAdminRoutes, { prefix: `${env.API_PREFIX}/admin/workers` });
  // Métricas de recursos (MQ-25): só tabelas locais, nunca a Render na requisição
  await app.register(opsMetricsRoutes, { prefix: `${env.API_PREFIX}/admin/ops/metrics` });
  // Custos da infraestrutura: preços em USD, rateio por plano (só tabelas locais)
  await app.register(infraCostsRoutes, { prefix: `${env.API_PREFIX}/admin/costs` });

  // ── Entitlements editáveis por plano (super admin) ─────────────────────────
  await app.register(planEntitlementAdminRoutes, { prefix: `${env.API_PREFIX}/admin/plan-entitlements` });

  // ── Links de redirecionamento da plataforma: CRUD (super admin) e resolução pública ──
  await app.register(redirectLinkAdminRoutes, { prefix: `${env.API_PREFIX}/admin/redirect-links` });
  await app.register(publicRedirectRoutes, { prefix: `${env.API_PREFIX}/public/redirects` });

  // ── Página de Ofertas do tenant (a pública sai pelo hook do rodízio, app.ts) ──
  await app.register(storefrontRoutes, { prefix: `${env.API_PREFIX}/storefront` });

  // ── Story de Oferta (arte 1080×1920 para Instagram, só Business) ────────────
  await app.register(offerStoryRoutes, { prefix: `${env.API_PREFIX}/offer-story` });

  // ── Billing webhook (HMAC-authenticated, no authHook) ──────────────────────
  const billingBlock = billingWebhookBlockReason(env);
  if (billingBlock) {
    logger.error(billingBlock);
  } else if (env.BILLING_ENABLED) {
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
