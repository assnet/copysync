import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { extensionAuthHook } from '../extensionAuthHook';
import { extensionRequestGuard } from '../extensionRequestGuard';
import { extensionContainer } from '../../infrastructure/extensionContainer';
import { IssueExtensionSessionUseCase } from '../../application/use-cases/IssueExtensionSessionUseCase';
import { RevokeExtensionSessionUseCase } from '../../application/use-cases/RevokeExtensionSessionUseCase';
import { GetExtensionProfileUseCase } from '../../application/use-cases/GetExtensionProfileUseCase';
import { RecordLifecycleSignalUseCase } from '../../application/use-cases/RecordLifecycleSignalUseCase';
import { RecordStoreClickUseCase } from '../../application/use-cases/RecordStoreClickUseCase';
import { RecordUninstallUseCase } from '../../application/use-cases/RecordUninstallUseCase';
import { STORE_CLICK_SOURCES, UNINSTALL_COMMENT_MAX, UNINSTALL_REASONS, type StoreClickSource } from '../../domain/lifecycleEvents';
import { setExtSessionCookie, clearExtSessionCookie } from '../../infrastructure/cookieHelper';
import { EXT_SESSION_TTL_SECONDS, ML_SESSION_COOKIES, SHEIN_SESSION_COOKIES } from '../../domain/constants';
import { SyncSheinSessionUseCase } from '../../application/use-cases/SyncSheinSessionUseCase';
import {
  DisconnectMarketplaceSessionUseCase,
  GrantMarketplaceConsentUseCase,
  type ConsentTarget,
} from '../../application/use-cases/MarketplaceConsentUseCases';
import type { IExtensionEntitlementReader } from '../../domain/contracts/IExtensionEntitlementReader';
import { DeleteAffiliateCredentialUseCase } from '../../../integrations/application/use-cases/DeleteAffiliateCredentialUseCase';
import { createMarketplaceRiskAcceptanceRepository } from '../../../integrations/infrastructure/marketplaceRiskTransaction';
import { AffiliateCredentialPresenter } from '../../../integrations/presentation/presenters/AffiliateCredentialPresenter';
import { sheinSessionSyncResponse } from '../../../integrations/presentation/schemas/affiliateCredential.schema';
import { marketplaceEntitlementKey } from '../../../campaigns/domain/services/marketplaceEntitlement';
import { httpResponse } from '../../../../shared/http/httpResponse';
import { UpsertAffiliateSessionUseCase } from '../../../integrations/application/use-cases/UpsertAffiliateSessionUseCase';
import { ClearAffiliateSessionUseCase } from '../../../integrations/application/use-cases/ClearAffiliateSessionUseCase';
import { PrismaAffiliateCredentialRepository } from '../../../integrations/infrastructure/repositories/PrismaAffiliateCredentialRepository';
import { MercadoLivreAffiliateClient } from '../../../campaigns/infrastructure/http/MercadoLivreAffiliateClient';
import { AffiliateCredentialRejectedError } from '../../../../shared/errors/internal/OfferErrors';
import { PrismaAuditLogRepository } from '../../../../shared/audit/PrismaAuditLogRepository';
import { SecretCipherFactory } from '../../../../shared/security/SecretCipherFactory';
import { logger } from '../../../../shared/logger/logger';
import { authHook } from '../../../../shared/http/hooks/authHook';
import { tenantHook } from '../../../../shared/http/hooks/tenantHook';
import { rateLimitPresets } from '../../../../shared/http/rateLimitPresets';
import { PrismaEntitlementReader } from '../../../tenants/infrastructure/repositories/PrismaEntitlementReader';
import { prisma } from '../../../../shared/database/prisma.client';
import { ENTITLEMENT_KEYS } from '../../../tenants/domain/entitlementKeys';

const _entitlementPrismaReader = new PrismaEntitlementReader(prisma);
const entitlementReader: IExtensionEntitlementReader = {
  async hasMarketplaceExtension(tenantId: string): Promise<boolean> {
    return (await _entitlementPrismaReader.getBoolean(tenantId, ENTITLEMENT_KEYS.MARKETPLACE_EXTENSION)) === true;
  },
  async hasMarketplace(tenantId, provider): Promise<boolean> {
    const key = marketplaceEntitlementKey(provider);
    return key === null || (await _entitlementPrismaReader.getBoolean(tenantId, key)) === true;
  },
};

const mlClient = new MercadoLivreAffiliateClient();
const upsertAffiliateSessionUseCase = new UpsertAffiliateSessionUseCase(
  new PrismaAffiliateCredentialRepository(),
  () => SecretCipherFactory.get(),
  new PrismaAuditLogRepository(),
);
const log = logger.child({ module: 'extension.routes' });

const clearMlSessionUseCase = new ClearAffiliateSessionUseCase(
  new PrismaAffiliateCredentialRepository(),
  new PrismaAuditLogRepository(),
);

const deleteCredentialUseCase = new DeleteAffiliateCredentialUseCase(
  new PrismaAffiliateCredentialRepository(),
  new PrismaAuditLogRepository(),
);
const riskAcceptances = createMarketplaceRiskAcceptanceRepository();
const SHEIN_TARGET: ConsentTarget = { marketplace: 'SHEIN', provider: 'SHEIN' };

const sheinCookieSchema = { type: 'string', minLength: 1, maxLength: 4096 } as const;

/**
 * Consentimento e desconexão por marketplace (painel, Bearer + tenant). As rotas `ml/*` ficam como
 * estão (extensão já instalada); marketplace novo entra por aqui.
 */
function registerMarketplaceConsentRoutes(app: FastifyInstance, path: string, target: ConsentTarget, label: string): void {
  app.post(
    `/marketplaces/${path}/consent`,
    {
      preHandler: [authHook, tenantHook],
      config: { rateLimit: rateLimitPresets.extensionAuth },
      schema: {
        tags: ['Extension'],
        summary: `Autorizar sincronização da ${label} nesta instalação`,
        security: [{ bearerAuth: [] }],
        body: {
          type: 'object',
          required: ['installationId'],
          properties: { installationId: { type: 'string', format: 'uuid' } },
        },
        response: { 200: { type: 'object', properties: { success: { type: 'boolean' } } } },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { tenantId, userId } = request.tenantContext;
      const { installationId } = request.body as { installationId: string };
      await new GrantMarketplaceConsentUseCase(target, extensionContainer.sessionRepository, entitlementReader, riskAcceptances)
        .execute({ userId, tenantId, installationId });
      return reply.send({ success: true });
    },
  );

  app.delete(
    `/marketplaces/${path}/session`,
    {
      preHandler: [authHook, tenantHook],
      schema: {
        tags: ['Extension'],
        summary: `Desconectar ${label} (revoga consentimento e apaga a credencial)`,
        security: [{ bearerAuth: [] }],
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { tenantId, userId } = request.tenantContext;
      await new DisconnectMarketplaceSessionUseCase(target, extensionContainer.sessionRepository, deleteCredentialUseCase)
        .execute({ tenantId, userId });
      httpResponse.noContent(reply);
      return reply;
    },
  );
}

export async function extensionRoutes(app: FastifyInstance): Promise<void> {
  // ── DELETE /marketplaces/ml/session — Disconnect ML (panel, Bearer) ──
  app.delete(
    '/marketplaces/ml/session',
    {
      preHandler: [authHook, tenantHook],
      schema: {
        tags: ['Extension'],
        summary: 'Desconectar Mercado Livre (apaga sessão e revoga consentimento)',
        security: [{ bearerAuth: [] }],
        response: { 200: { type: 'object', properties: { success: { type: 'boolean' } } } },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { tenantId, userId } = request.tenantContext;
      // Consent first: otherwise the extension may re-sync between the two writes.
      await extensionContainer.sessionRepository.revokeMlConsentForTenant(tenantId);
      await clearMlSessionUseCase.execute({ tenantId, userId, provider: 'MERCADO_LIVRE' });
      return reply.send({ success: true });
    },
  );

  // ── POST /marketplaces/ml/consent — Re-grant ML consent (panel, Bearer) ─
  app.post(
    '/marketplaces/ml/consent',
    {
      preHandler: [authHook, tenantHook],
      config: { rateLimit: rateLimitPresets.extensionAuth },
      schema: {
        tags: ['Extension'],
        summary: 'Autorizar sincronização do Mercado Livre nesta instalação',
        security: [{ bearerAuth: [] }],
        body: {
          type: 'object',
          required: ['installationId'],
          properties: { installationId: { type: 'string', format: 'uuid' } },
        },
        response: { 200: { type: 'object', properties: { success: { type: 'boolean' } } } },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { tenantId, userId } = request.tenantContext;
      const { installationId } = request.body as { installationId: string };
      if (!(await entitlementReader.hasMarketplaceExtension(tenantId))) {
        return reply.code(403).send({ success: false, error: { code: 'EXTENSION_NOT_ENTITLED', message: 'Marketplace extension is not available on the current plan' } });
      }
      const granted = await extensionContainer.sessionRepository.grantMlConsent(userId, installationId, tenantId, new Date());
      if (!granted) {
        return reply.code(404).send({ success: false, error: { code: 'SESSION_NOT_FOUND', message: 'Extension session not found for this installation' } });
      }
      return reply.send({ success: true });
    },
  );

  // ── PUT /marketplaces/ml/session — ML session sync (cookie auth) ─────
  app.put(
    '/marketplaces/ml/session',
    {
      preHandler: [extensionAuthHook],
      onRequest: [extensionRequestGuard],
      config: { rateLimit: rateLimitPresets.extensionSync },
      schema: {
        tags: ['Extension'],
        summary: 'Sincronizar sessão do Mercado Livre',
        body: {
          type: 'object',
          required: ['cookies', 'capturedAt'],
          properties: {
            cookies: {
              type: 'object',
              required: ['ssid'],
              maxProperties: 16,
              additionalProperties: { type: 'string', maxLength: 4096 },
            },
            capturedAt: { type: 'string', maxLength: 64 },
          },
        },
        response: {
          200: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: {
                type: 'object',
                properties: {
                  affiliateTag: { type: ['string', 'null'] },
                  sessionRejected: { type: 'boolean' },
                },
              },
            },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const session = request.extensionSession!;
      if (!session.mlConsent) {
        return reply.code(403).send({ success: false, error: { code: 'ML_CONSENT_REQUIRED', message: 'ML session consent not granted' } });
      }
      if (!(await entitlementReader.hasMarketplaceExtension(session.mlTenantId))) {
        return reply.code(403).send({ success: false, error: { code: 'EXTENSION_NOT_ENTITLED', message: 'Marketplace extension is not available on the current plan' } });
      }

      const body = request.body as { cookies: Record<string, string>; capturedAt: string };
      const cookies: Record<string, string> = {};
      for (const name of ML_SESSION_COOKIES) {
        const value = body.cookies[name];
        if (typeof value === 'string' && value) cookies[name] = value;
      }

      // Tag is best-effort: an ML outage must never block storing the session.
      // The same call checks the session on ML: it decides the store rejection
      // (the browser may stay logged in with a token ML refuses server-side).
      let affiliateTag: string | null = null;
      let sessionCheck: 'VALID' | 'REJECTED' | undefined;
      try {
        affiliateTag = await mlClient.getActiveTag(cookies);
        sessionCheck = 'VALID';
      } catch (err) {
        if (err instanceof AffiliateCredentialRejectedError) sessionCheck = 'REJECTED';
        log.warn({ reason: (err as Error)?.name }, 'ML active tag lookup failed');
      }

      await upsertAffiliateSessionUseCase.execute({
        tenantId: session.mlTenantId,
        userId: session.userId,
        provider: 'MERCADO_LIVRE',
        cookies,
        ...(affiliateTag && { affiliateTag }),
        capturedAt: body.capturedAt,
        ...(sessionCheck && { sessionCheck }),
      });

      return reply.send({ success: true, data: { affiliateTag, sessionRejected: sessionCheck === 'REJECTED' } });
    },
  );

  // ── Shein: consentimento e desconexão (painel) ─────────────────────────
  registerMarketplaceConsentRoutes(app, 'shein', SHEIN_TARGET, 'Shein');

  // ── PUT /marketplaces/shein/session — Shein session sync (cookie auth) ─
  app.put(
    '/marketplaces/shein/session',
    {
      preHandler: [extensionAuthHook],
      onRequest: [extensionRequestGuard],
      config: { rateLimit: rateLimitPresets.extensionSync },
      schema: {
        tags: ['Extension'],
        summary: 'Sincronizar sessão da Shein',
        body: {
          type: 'object',
          required: ['cookies', 'capturedAt'],
          properties: {
            // Ajv com `removeAdditional`: cookie não declarado é removido (nunca chega ao use case).
            cookies: {
              type: 'object',
              required: [...SHEIN_SESSION_COOKIES],
              properties: { AT: sheinCookieSchema, memberId: sheinCookieSchema },
              additionalProperties: false,
            },
            // `format` validado pelo ajv-formats que o @fastify/ajv-compiler já registra.
            capturedAt: { type: 'string', format: 'date-time', maxLength: 64 },
          },
          additionalProperties: false,
        },
        response: { 200: sheinSessionSyncResponse },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const session = request.extensionSession!;
      const body = request.body as { cookies: { AT: string; memberId: string }; capturedAt: string };
      const result = await sheinSyncUseCase().execute({ session, cookies: body.cookies, capturedAt: body.capturedAt });
      httpResponse.ok(reply, AffiliateCredentialPresenter.toSheinSessionSync(result));
      return reply;
    },
  );

  // ── POST /session — Issue extension session (Bearer auth) ──────────
  app.post(
    '/session',
    {
      preHandler: [authHook, tenantHook],
      config: { rateLimit: rateLimitPresets.extensionAuth },
      schema: {
        tags: ['Extension'],
        summary: 'Emitir sessão de extensão',
        security: [{ bearerAuth: [] }],
        body: {
          type: 'object',
          required: ['installationId', 'extVersion', 'extensionId', 'channel'],
          properties: {
            installationId: { type: 'string', format: 'uuid' },
            deviceId: { type: 'string' },
            extVersion: { type: 'string' },
            extensionId: { type: 'string' },
            channel: { type: 'string' },
            mlSessionConsent: { type: 'boolean', default: false },
          },
        },
        response: {
          201: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: {
                type: 'object',
                properties: {
                  sessionId: { type: 'string' },
                  expiresAt: { type: 'string', format: 'date-time' },
                },
              },
            },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { installationId, deviceId, extVersion, extensionId, channel, mlSessionConsent } =
        request.body as { installationId: string; deviceId?: string; extVersion: string; extensionId: string; channel: string; mlSessionConsent?: boolean };
      const { userId } = request.user;
      const tenantId = request.tenantContext?.tenantId;

      if (!tenantId) {
        return reply.code(403).send({
          success: false,
          error: { code: 'NO_TENANT_CONTEXT', message: 'Tenant context required to issue extension session' },
        });
      }

      const useCase = new IssueExtensionSessionUseCase(
        extensionContainer.sessionRepository,
        extensionContainer.installationRepository,
        entitlementReader,
        extensionContainer.lifecycleRepository,
        undefined,
        (err) => log.warn({ reason: (err as Error)?.name }, 'extension LINKED lifecycle event failed'),
      );

      const result = await useCase.execute({
        userId,
        mlTenantId: tenantId,
        installationId,
        deviceId,
        extVersion,
        extensionId,
        channel,
        mlSessionConsent: mlSessionConsent ?? false,
      });

      setExtSessionCookie(reply, result.rawToken, EXT_SESSION_TTL_SECONDS);

      return reply.code(201).send({
        success: true,
        data: {
          sessionId: result.session.id,
          expiresAt: result.session.expiresAt.toISOString(),
        },
      });
    },
  );

  // ── DELETE /session — Revoke current extension session (cookie auth) ──
  app.delete(
    '/session',
    {
      preHandler: [extensionAuthHook],
      onRequest: [extensionRequestGuard],
      schema: {
        tags: ['Extension'],
        summary: 'Revogar sessão de extensão atual',
        response: {
          200: {
            type: 'object',
            properties: { success: { type: 'boolean' } },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const session = request.extensionSession!;
      const useCase = new RevokeExtensionSessionUseCase(extensionContainer.sessionRepository);
      await useCase.execute(session.sessionId);
      clearExtSessionCookie(reply);
      return reply.send({ success: true });
    },
  );

  // ── GET /me — Extension profile (cookie auth) ────────────────────────
  app.get(
    '/me',
    {
      preHandler: [extensionAuthHook],
      onRequest: [extensionRequestGuard],
      schema: {
        tags: ['Extension'],
        summary: 'Perfil do usuário na extensão',
        response: {
          200: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: {
                type: 'object',
                properties: {
                  user: {
                    type: 'object',
                    properties: {
                      id: { type: 'string' },
                      name: { type: 'string' },
                      email: { type: 'string' },
                    },
                  },
                  mlTenantId: { type: 'string' },
                  tenants: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        id: { type: 'string' },
                        name: { type: 'string' },
                        slug: { type: 'string' },
                        role: { type: 'string' },
                        status: { type: 'string' },
                        permissions: { type: 'array', items: { type: 'string' } },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const session = request.extensionSession!;
      const useCase = new GetExtensionProfileUseCase(entitlementReader);
      const profile = await useCase.execute(session.userId, session.mlTenantId);
      return reply.send({ success: true, data: profile });
    },
  );

  // ── POST /heartbeat — Extension heartbeat (cookie auth) ──────────────
  app.post(
    '/heartbeat',
    {
      preHandler: [extensionAuthHook],
      onRequest: [extensionRequestGuard],
      config: { rateLimit: rateLimitPresets.extensionSync },
      schema: {
        tags: ['Extension'],
        summary: 'Heartbeat da extensão',
        body: {
          type: 'object',
          properties: {
            extVersion: { type: 'string' },
          },
        },
        response: {
          200: {
            type: 'object',
            properties: { success: { type: 'boolean' } },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const session = request.extensionSession!;
      const body = request.body as { extVersion?: string } | undefined;
      await extensionContainer.installationRepository.updateLastSeen(session.installationId, {
        lastSeenAt: new Date(),
        lastHeartbeatAt: new Date(),
        ...(body?.extVersion && { version: body.extVersion }),
      });
      return reply.send({ success: true });
    },
  );

  // ── GET /sessions — List user's extension sessions (Bearer auth) ─────
  app.get(
    '/sessions',
    {
      preHandler: [authHook],
      schema: {
        tags: ['Extension'],
        summary: 'Listar sessões de extensão do usuário',
        security: [{ bearerAuth: [] }],
        response: {
          200: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    id: { type: 'string' },
                    installationId: { type: 'string' },
                    mlTenantId: { type: 'string' },
                    extVersion: { type: 'string' },
                    lastSeenAt: { type: 'string', format: 'date-time' },
                    expiresAt: { type: 'string', format: 'date-time' },
                    createdAt: { type: 'string', format: 'date-time' },
                  },
                },
              },
            },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const sessions = await extensionContainer.sessionRepository.findActiveByUserId(request.user.userId);
      return reply.send({
        success: true,
        data: sessions.map(s => ({
          id: s.id,
          installationId: s.installationId,
          mlTenantId: s.mlTenantId,
          extVersion: s.extVersion,
          lastSeenAt: s.lastSeenAt.toISOString(),
          expiresAt: s.expiresAt.toISOString(),
          createdAt: s.createdAt.toISOString(),
        })),
      });
    },
  );

  // ── DELETE /sessions/:id — Revoke specific session (Bearer auth) ─────
  app.delete(
    '/sessions/:id',
    {
      preHandler: [authHook],
      schema: {
        tags: ['Extension'],
        summary: 'Revogar sessão de extensão específica',
        security: [{ bearerAuth: [] }],
        params: {
          type: 'object',
          required: ['id'],
          properties: { id: { type: 'string' } },
        },
        response: {
          200: {
            type: 'object',
            properties: { success: { type: 'boolean' } },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const sessions = await extensionContainer.sessionRepository.findActiveByUserId(request.user.userId);
      if (!sessions.some(s => s.id === id)) {
        return reply.code(404).send({ success: false, error: { code: 'SESSION_NOT_FOUND', message: 'Extension session not found' } });
      }
      const useCase = new RevokeExtensionSessionUseCase(extensionContainer.sessionRepository);
      await useCase.execute(id);
      return reply.send({ success: true });
    },
  );

  // ── POST /lifecycle/event — Public lifecycle signal ───────────────────
  app.post(
    '/lifecycle/event',
    {
      config: { rateLimit: rateLimitPresets.lifecycle },
      schema: {
        tags: ['Extension'],
        summary: 'Sinal de ciclo de vida da extensão (público)',
        body: {
          type: 'object',
          required: ['installationId', 'type', 'version', 'channel', 'dedupeKey'],
          properties: {
            installationId: { type: 'string', maxLength: 64 },
            type: { type: 'string', maxLength: 16 },
            version: { type: 'string', maxLength: 32 },
            channel: { type: 'string', maxLength: 16 },
            dedupeKey: { type: 'string', maxLength: 64 },
            extensionId: { type: 'string', maxLength: 32 },
            previousVersion: { type: 'string', maxLength: 32 },
          },
        },
        response: {
          200: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: {
                type: 'object',
                properties: { created: { type: 'boolean' } },
              },
            },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const useCase = new RecordLifecycleSignalUseCase(extensionContainer.installationRepository, extensionContainer.lifecycleRepository);
      const result = await useCase.execute(
        request.body as { installationId: string; type: string; version: string; channel: string; dedupeKey: string; extensionId?: string },
      );
      return reply.send({ success: true, data: result });
    },
  );

  // ── POST /store-click — Clique em "Instalar da Chrome Web Store" (painel, Bearer) ──
  app.post(
    '/store-click',
    {
      preHandler: [authHook, tenantHook],
      config: { rateLimit: rateLimitPresets.extensionAuth },
      schema: {
        tags: ['Extension'],
        summary: 'Registrar clique para instalar a extensão na loja',
        security: [{ bearerAuth: [] }],
        body: {
          type: 'object',
          required: ['source'],
          additionalProperties: false,
          properties: { source: { type: 'string', enum: [...STORE_CLICK_SOURCES] } },
        },
        response: {
          200: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: { type: 'object', properties: { recorded: { type: 'boolean' } } },
            },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { tenantId, userId } = request.tenantContext;
      const { source } = request.body as { source: StoreClickSource };
      const result = await new RecordStoreClickUseCase(extensionContainer.lifecycleRepository).execute({ userId, tenantId, source });
      return reply.send({ success: true, data: result });
    },
  );

  // ── POST /lifecycle/uninstall — Uninstall signal (public) ─────────────
  app.post(
    '/lifecycle/uninstall',
    {
      config: { rateLimit: rateLimitPresets.lifecycle },
      schema: {
        tags: ['Extension'],
        summary: 'Sinal de desinstalação da extensão (público)',
        body: {
          type: 'object',
          required: ['installationId'],
          properties: {
            installationId: { type: 'string', maxLength: 64 },
            extensionId: { type: 'string', maxLength: 32 },
            version: { type: 'string', maxLength: 32 },
          },
        },
        response: { 200: { type: 'object', properties: { success: { type: 'boolean' } } } },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = request.body as { installationId: string; version?: string };
      await uninstallUseCase().execute({ installationId: body.installationId, version: body.version });
      return reply.send({ success: true });
    },
  );

  // ── POST /lifecycle/feedback — Pesquisa de desinstalação (público) ────
  app.post(
    '/lifecycle/feedback',
    {
      config: { rateLimit: rateLimitPresets.lifecycle },
      schema: {
        tags: ['Extension'],
        summary: 'Motivos da desinstalação da extensão (público)',
        body: {
          type: 'object',
          required: ['installationId', 'reasons'],
          properties: {
            installationId: { type: 'string', maxLength: 64 },
            extensionId: { type: 'string', maxLength: 32 },
            version: { type: 'string', maxLength: 32 },
            reasons: {
              type: 'array', minItems: 1, maxItems: UNINSTALL_REASONS.length, uniqueItems: true,
              items: { type: 'string', enum: [...UNINSTALL_REASONS] },
            },
            comment: { type: 'string', maxLength: UNINSTALL_COMMENT_MAX },
          },
        },
        response: { 200: { type: 'object', properties: { success: { type: 'boolean' } } } },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = request.body as { installationId: string; version?: string; reasons: string[]; comment?: string };
      await uninstallUseCase().execute({
        installationId: body.installationId,
        version: body.version,
        feedback: { reasons: body.reasons, comment: body.comment ?? null },
      });
      return reply.send({ success: true });
    },
  );
}

function sheinSyncUseCase(): SyncSheinSessionUseCase {
  return new SyncSheinSessionUseCase({
    riskAcceptances,
    entitlements: entitlementReader,
    profile: new GetExtensionProfileUseCase(entitlementReader),
    upsertSession: upsertAffiliateSessionUseCase,
    sessions: extensionContainer.sessionRepository,
    deleteCredential: deleteCredentialUseCase,
  });
}

function uninstallUseCase(): RecordUninstallUseCase {
  return new RecordUninstallUseCase(extensionContainer.installationRepository, extensionContainer.lifecycleRepository);
}
