import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { authHook } from '../../../../shared/http/hooks/authHook';
import { tenantHook } from '../../../../shared/http/hooks/tenantHook';
import { SessionPresenter } from '../presenters/SessionPresenter';
import { createSessionBodySchema, sessionIdParamSchema } from '../schemas/session.schema';
import { PrismaSessionRepository } from '../../infrastructure/repositories/PrismaSessionRepository';
import { PrismaSessionAuthStateRepository } from '../../infrastructure/repositories/PrismaSessionAuthStateRepository';
import { PrismaAuditLogRepository } from '../../../../shared/audit/PrismaAuditLogRepository';
import { MessagingEngineFactory } from '../../../messaging/infrastructure/MessagingEngineFactory';
import { CreateSessionUseCase } from '../../application/use-cases/CreateSessionUseCase';
import { ListSessionsUseCase } from '../../application/use-cases/ListSessionsUseCase';
import { GetSessionByIdUseCase } from '../../application/use-cases/GetSessionByIdUseCase';
import { GetSessionStatusUseCase } from '../../application/use-cases/GetSessionStatusUseCase';
import { ConnectSessionUseCase } from '../../application/use-cases/ConnectSessionUseCase';
import { DisconnectSessionUseCase } from '../../application/use-cases/DisconnectSessionUseCase';
import { ReconnectSessionUseCase } from '../../application/use-cases/ReconnectSessionUseCase';
import { LogoutSessionUseCase } from '../../application/use-cases/LogoutSessionUseCase';
import { GetSessionQrUseCase } from '../../application/use-cases/GetSessionQrUseCase';
import { GetSessionPairingCodeUseCase } from '../../application/use-cases/GetSessionPairingCodeUseCase';
import { DeleteSessionUseCase } from '../../application/use-cases/DeleteSessionUseCase';

// ── Shared dependencies ───────────────────────────────────────────────────────
const sessionRepo = new PrismaSessionRepository();
const authStateRepo = new PrismaSessionAuthStateRepository();
const auditRepo = new PrismaAuditLogRepository();

// Engine singleton — wired once, shared across all requests
const engine = MessagingEngineFactory.create('baileys', sessionRepo, authStateRepo);

// ── Use cases ─────────────────────────────────────────────────────────────────
const createSessionUseCase = new CreateSessionUseCase(sessionRepo, auditRepo);
const listSessionsUseCase = new ListSessionsUseCase(sessionRepo);
const getSessionByIdUseCase = new GetSessionByIdUseCase(sessionRepo);
const getSessionStatusUseCase = new GetSessionStatusUseCase(sessionRepo);
const connectSessionUseCase = new ConnectSessionUseCase(sessionRepo, auditRepo, engine);
const disconnectSessionUseCase = new DisconnectSessionUseCase(sessionRepo, auditRepo, engine);
const reconnectSessionUseCase = new ReconnectSessionUseCase(sessionRepo, auditRepo, engine);
const logoutSessionUseCase = new LogoutSessionUseCase(sessionRepo, authStateRepo, auditRepo, engine);
const getSessionQrUseCase = new GetSessionQrUseCase(sessionRepo, engine);
const getSessionPairingCodeUseCase = new GetSessionPairingCodeUseCase(sessionRepo, engine);
const deleteSessionUseCase = new DeleteSessionUseCase(sessionRepo, authStateRepo, auditRepo, engine);

// Both auth + tenant context required for all session routes
const preHandler = [authHook, tenantHook];
type IdParam = { id: string };

// OpenAPI: header x-tenant-id required on all session routes
const tenantHeader = {
  type: 'object',
  required: ['x-tenant-id'],
  properties: { 'x-tenant-id': { type: 'string', description: 'ID do tenant ativo' } },
} as const;

/**
 * Session routes — require authentication AND an active tenant context.
 * All operations are scoped to request.tenantContext.tenantId.
 * Registered under /api/sessions.
 */
export async function sessionRoutes(app: FastifyInstance): Promise<void> {
  // ── POST /sessions — create new session ────────────────────────────────────
  app.post(
    '/',
    {
      preHandler,
      schema: {
        tags: ['Sessions'],
        summary: 'Criar sessão',
        description: 'Cria uma nova sessão de mensageria para o tenant.',
        security: [{ bearerAuth: [] }],
        headers: tenantHeader,
        body: createSessionBodySchema,
        response: {
          201: { $ref: 'SessionItem#' },
          401: { $ref: 'ErrorResponse#' },
          422: { $ref: 'ErrorResponse#' },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { tenantId, userId } = request.tenantContext;
      const { name, engine } = request.body as { name: string; engine?: string };

      const session = await createSessionUseCase.execute({ tenantId, userId, name, engine });
      reply.status(201).send(SessionPresenter.toSessionItem(session));
    },
  );

  // ── GET /sessions — list sessions for tenant ───────────────────────────────
  app.get(
    '/',
    {
      preHandler,
      schema: {
        tags: ['Sessions'],
        summary: 'Listar sessões',
        description: 'Retorna todas as sessões do tenant.',
        security: [{ bearerAuth: [] }],
        headers: tenantHeader,
        response: {
          200: {
            type: 'object',
            properties: {
              sessions: { type: 'array', items: { $ref: 'SessionItem#' } },
              total: { type: 'number' },
            },
          },
          401: { $ref: 'ErrorResponse#' },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { tenantId } = request.tenantContext;
      const sessions = await listSessionsUseCase.execute({ tenantId });
      reply.status(200).send(SessionPresenter.toSessionList(sessions));
    },
  );

  // ── GET /sessions/:id — get session by id ─────────────────────────────────
  app.get(
    '/:id',
    {
      preHandler,
      schema: {
        tags: ['Sessions'],
        summary: 'Buscar sessão por ID',
        security: [{ bearerAuth: [] }],
        headers: tenantHeader,
        params: sessionIdParamSchema,
        response: {
          200: { $ref: 'SessionItem#' },
          401: { $ref: 'ErrorResponse#' },
          404: { $ref: 'ErrorResponse#' },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { tenantId } = request.tenantContext;
      const { id } = request.params as IdParam;
      const session = await getSessionByIdUseCase.execute({ sessionId: id, tenantId });
      reply.status(200).send(SessionPresenter.toSessionItem(session));
    },
  );

  // ── GET /sessions/:id/status — get session status ─────────────────────────
  app.get(
    '/:id/status',
    {
      preHandler,
      schema: {
        tags: ['Sessions'],
        summary: 'Status da sessão',
        security: [{ bearerAuth: [] }],
        headers: tenantHeader,
        params: sessionIdParamSchema,
        response: {
          200: {
            type: 'object',
            properties: {
              sessionId: { type: 'string' },
              status: { $ref: 'SessionStatus#' },
              phone: { type: 'string', nullable: true },
              lastConnectedAt: { type: 'string', format: 'date-time', nullable: true },
              lastDisconnectedAt: { type: 'string', format: 'date-time', nullable: true },
            },
          },
          401: { $ref: 'ErrorResponse#' },
          404: { $ref: 'ErrorResponse#' },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { tenantId } = request.tenantContext;
      const { id } = request.params as IdParam;
      const result = await getSessionStatusUseCase.execute({ sessionId: id, tenantId });
      reply.status(200).send(SessionPresenter.toSessionStatus(result));
    },
  );

  // ── POST /sessions/:id/connect — request connection ───────────────────────
  app.post(
    '/:id/connect',
    {
      preHandler,
      schema: {
        tags: ['Sessions'],
        summary: 'Conectar sessão',
        description: 'Inicia a conexão da sessão. Retorna QR code ou pairing code quando disponível.',
        security: [{ bearerAuth: [] }],
        headers: tenantHeader,
        params: sessionIdParamSchema,
        response: {
          200: {
            type: 'object',
            properties: {
              sessionId: { type: 'string' },
              status: { $ref: 'SessionStatus#' },
              qrCode: { type: 'string', nullable: true },
              pairingCode: { type: 'string', nullable: true },
            },
          },
          401: { $ref: 'ErrorResponse#' },
          404: { $ref: 'ErrorResponse#' },
          409: { $ref: 'ErrorResponse#' },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { tenantId, userId } = request.tenantContext;
      const { id } = request.params as IdParam;
      const result = await connectSessionUseCase.execute({ sessionId: id, tenantId, userId });
      reply.status(200).send(SessionPresenter.toConnectResult(result));
    },
  );

  // ── POST /sessions/:id/disconnect — request disconnection ─────────────────
  app.post(
    '/:id/disconnect',
    {
      preHandler,
      schema: {
        tags: ['Sessions'],
        summary: 'Desconectar sessão',
        security: [{ bearerAuth: [] }],
        headers: tenantHeader,
        params: sessionIdParamSchema,
        response: {
          200: {
            type: 'object',
            properties: {
              sessionId: { type: 'string' },
              status: { $ref: 'SessionStatus#' },
            },
          },
          401: { $ref: 'ErrorResponse#' },
          404: { $ref: 'ErrorResponse#' },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { tenantId, userId } = request.tenantContext;
      const { id } = request.params as IdParam;
      const result = await disconnectSessionUseCase.execute({ sessionId: id, tenantId, userId });
      reply.status(200).send(SessionPresenter.toActionResult(result));
    },
  );

  // ── POST /sessions/:id/reconnect — request reconnection ───────────────────
  app.post(
    '/:id/reconnect',
    {
      preHandler,
      schema: {
        tags: ['Sessions'],
        summary: 'Reconectar sessão',
        security: [{ bearerAuth: [] }],
        headers: tenantHeader,
        params: sessionIdParamSchema,
        response: {
          200: {
            type: 'object',
            properties: {
              sessionId: { type: 'string' },
              status: { $ref: 'SessionStatus#' },
              qrCode: { type: 'string', nullable: true },
              pairingCode: { type: 'string', nullable: true },
            },
          },
          401: { $ref: 'ErrorResponse#' },
          404: { $ref: 'ErrorResponse#' },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { tenantId, userId } = request.tenantContext;
      const { id } = request.params as IdParam;
      const result = await reconnectSessionUseCase.execute({ sessionId: id, tenantId, userId });
      reply.status(200).send(SessionPresenter.toConnectResult(result));
    },
  );

  // ── POST /sessions/:id/logout — logical logout ────────────────────────────
  app.post(
    '/:id/logout',
    {
      preHandler,
      schema: {
        tags: ['Sessions'],
        summary: 'Logout da sessão',
        description: 'Encerra a sessão e remove o estado de autenticação.',
        security: [{ bearerAuth: [] }],
        headers: tenantHeader,
        params: sessionIdParamSchema,
        response: {
          200: {
            type: 'object',
            properties: {
              sessionId: { type: 'string' },
              status: { $ref: 'SessionStatus#' },
            },
          },
          401: { $ref: 'ErrorResponse#' },
          404: { $ref: 'ErrorResponse#' },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { tenantId, userId } = request.tenantContext;
      const { id } = request.params as IdParam;
      const result = await logoutSessionUseCase.execute({ sessionId: id, tenantId, userId });
      reply.status(200).send(SessionPresenter.toActionResult(result));
    },
  );

  // ── GET /sessions/:id/qr — get current QR code ───────────────────────────
  app.get(
    '/:id/qr',
    {
      preHandler,
      schema: {
        tags: ['Sessions'],
        summary: 'QR code da sessão',
        description: 'Retorna o QR code atual da sessão, ou null se não disponível.',
        security: [{ bearerAuth: [] }],
        headers: tenantHeader,
        params: sessionIdParamSchema,
        response: {
          200: {
            type: 'object',
            properties: {
              sessionId: { type: 'string' },
              qrCode: { type: 'string', nullable: true },
            },
          },
          401: { $ref: 'ErrorResponse#' },
          404: { $ref: 'ErrorResponse#' },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { tenantId } = request.tenantContext;
      const { id } = request.params as IdParam;
      const result = await getSessionQrUseCase.execute({ sessionId: id, tenantId });
      reply.status(200).send(SessionPresenter.toQrResult(result));
    },
  );

  // ── GET /sessions/:id/pairing-code — get current pairing code ────────────
  app.get(
    '/:id/pairing-code',
    {
      preHandler,
      schema: {
        tags: ['Sessions'],
        summary: 'Pairing code da sessão',
        description: 'Retorna o pairing code atual da sessão, ou null se não disponível.',
        security: [{ bearerAuth: [] }],
        headers: tenantHeader,
        params: sessionIdParamSchema,
        response: {
          200: {
            type: 'object',
            properties: {
              sessionId: { type: 'string' },
              pairingCode: { type: 'string', nullable: true },
            },
          },
          401: { $ref: 'ErrorResponse#' },
          404: { $ref: 'ErrorResponse#' },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { tenantId } = request.tenantContext;
      const { id } = request.params as IdParam;
      const result = await getSessionPairingCodeUseCase.execute({ sessionId: id, tenantId });
      reply.status(200).send(SessionPresenter.toPairingCodeResult(result));
    },
  );

  // ── DELETE /sessions/:id — soft-delete session ────────────────────────────
  app.delete(
    '/:id',
    {
      preHandler,
      schema: {
        tags: ['Sessions'],
        summary: 'Deletar sessão',
        description: 'Remove permanentemente a sessão (soft-delete). Desconecta do WhatsApp se ativa.',
        security: [{ bearerAuth: [] }],
        headers: tenantHeader,
        params: sessionIdParamSchema,
        response: {
          204: { type: 'null', description: 'Sessão deletada com sucesso' },
          401: { $ref: 'ErrorResponse#' },
          404: { $ref: 'ErrorResponse#' },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { tenantId, userId } = request.tenantContext;
      const { id } = request.params as IdParam;
      await deleteSessionUseCase.execute({ sessionId: id, tenantId, userId });
      reply.status(204).send();
    },
  );
}
