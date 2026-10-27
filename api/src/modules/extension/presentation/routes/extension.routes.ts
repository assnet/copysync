import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { extensionAuthHook } from '../extensionAuthHook';
import { extensionRequestGuard } from '../extensionRequestGuard';
import { extensionContainer } from '../../infrastructure/extensionContainer';
import { IssueExtensionSessionUseCase } from '../../application/use-cases/IssueExtensionSessionUseCase';
import { RevokeExtensionSessionUseCase } from '../../application/use-cases/RevokeExtensionSessionUseCase';
import { GetExtensionProfileUseCase } from '../../application/use-cases/GetExtensionProfileUseCase';
import { RecordLifecycleSignalUseCase } from '../../application/use-cases/RecordLifecycleSignalUseCase';
import { setExtSessionCookie, clearExtSessionCookie } from '../../infrastructure/cookieHelper';
import { EXT_SESSION_TTL_SECONDS, ML_SESSION_COOKIES } from '../../domain/constants';
import { UpsertAffiliateSessionUseCase } from '../../../integrations/application/use-cases/UpsertAffiliateSessionUseCase';
import { PrismaAffiliateCredentialRepository } from '../../../integrations/infrastructure/repositories/PrismaAffiliateCredentialRepository';
import { MercadoLivreAffiliateClient } from '../../../campaigns/infrastructure/http/MercadoLivreAffiliateClient';
import { PrismaAuditLogRepository } from '../../../../shared/audit/PrismaAuditLogRepository';
import { SecretCipherFactory } from '../../../../shared/security/SecretCipherFactory';
import { logger } from '../../../../shared/logger/logger';
import { authHook } from '../../../../shared/http/hooks/authHook';
import { tenantHook } from '../../../../shared/http/hooks/tenantHook';
import { rateLimitPresets } from '../../../../shared/http/rateLimitPresets';
import { PrismaEntitlementReader } from '../../../tenants/infrastructure/repositories/PrismaEntitlementReader';
import { prisma } from '../../../../shared/database/prisma.client';

const _entitlementPrismaReader = new PrismaEntitlementReader(prisma);
const entitlementReader = {
  async hasMarketplaceExtension(tenantId: string): Promise<boolean> {
    return (await _entitlementPrismaReader.getBoolean(tenantId, 'marketplace_extension')) === true;
  },
};

const mlClient = new MercadoLivreAffiliateClient();
const syncMlSessionUseCase = new UpsertAffiliateSessionUseCase(
  new PrismaAffiliateCredentialRepository(),
  () => SecretCipherFactory.get(),
  new PrismaAuditLogRepository(),
);
const log = logger.child({ module: 'extension.routes' });

export async function extensionRoutes(app: FastifyInstance): Promise<void> {
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
                properties: { affiliateTag: { type: ['string', 'null'] } },
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
      let affiliateTag: string | null = null;
      try {
        affiliateTag = await mlClient.getActiveTag(cookies);
      } catch (err) {
        log.warn({ reason: (err as Error)?.name }, 'ML active tag lookup failed');
      }

      await syncMlSessionUseCase.execute({
        tenantId: session.mlTenantId,
        userId: session.userId,
        provider: 'MERCADO_LIVRE',
        cookies,
        ...(affiliateTag && { affiliateTag }),
        capturedAt: body.capturedAt,
      });

      return reply.send({ success: true, data: { affiliateTag } });
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
                  id: { type: 'string' },
                  name: { type: 'string' },
                  email: { type: 'string' },
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
                        mlSessionAllowed: { type: 'boolean' },
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
      const profile = await useCase.execute(session.userId);
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
            installationId: { type: 'string' },
            type: { type: 'string' },
            version: { type: 'string' },
            channel: { type: 'string' },
            dedupeKey: { type: 'string' },
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
      const useCase = new RecordLifecycleSignalUseCase(extensionContainer.installationRepository);
      const result = await useCase.execute(
        request.body as { installationId: string; type: string; version: string; channel: string; dedupeKey: string },
      );
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
            installationId: { type: 'string' },
            feedback: { type: 'string' },
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
      const body = request.body as { installationId: string; feedback?: string };
      const useCase = new RecordLifecycleSignalUseCase(extensionContainer.installationRepository);
      await useCase.execute({
        installationId: body.installationId,
        type: 'uninstall',
        version: 'unknown',
        channel: 'unknown',
        dedupeKey: `uninstall:${body.installationId}`,
      });
      return reply.send({ success: true });
    },
  );
}
