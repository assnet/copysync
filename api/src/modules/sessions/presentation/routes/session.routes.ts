import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { authHook } from '../../../../shared/http/hooks/authHook';
import { tenantHook } from '../../../../shared/http/hooks/tenantHook';
import { httpResponse } from '../../../../shared/http/httpResponse';
import { SessionPresenter } from '../presenters/SessionPresenter';
import { createSessionBodySchema, sessionIdParamSchema } from '../schemas/session.schema';
import { PrismaSessionRepository } from '../../infrastructure/repositories/PrismaSessionRepository';
import { PrismaSessionAuthStateRepository } from '../../infrastructure/repositories/PrismaSessionAuthStateRepository';
import { PrismaAuditLogRepository } from '../../../../shared/audit/PrismaAuditLogRepository';
import { CreateSessionUseCase } from '../../application/use-cases/CreateSessionUseCase';
import { ListSessionsUseCase } from '../../application/use-cases/ListSessionsUseCase';
import { GetSessionByIdUseCase } from '../../application/use-cases/GetSessionByIdUseCase';
import { GetSessionStatusUseCase } from '../../application/use-cases/GetSessionStatusUseCase';
import { ConnectSessionUseCase } from '../../application/use-cases/ConnectSessionUseCase';
import { DisconnectSessionUseCase } from '../../application/use-cases/DisconnectSessionUseCase';
import { ReconnectSessionUseCase } from '../../application/use-cases/ReconnectSessionUseCase';
import { LogoutSessionUseCase } from '../../application/use-cases/LogoutSessionUseCase';

// ── Shared dependencies ───────────────────────────────────────────────────────
const sessionRepo = new PrismaSessionRepository();
const authStateRepo = new PrismaSessionAuthStateRepository();
const auditRepo = new PrismaAuditLogRepository();

// ── Use cases ─────────────────────────────────────────────────────────────────
const createSessionUseCase = new CreateSessionUseCase(sessionRepo, auditRepo);
const listSessionsUseCase = new ListSessionsUseCase(sessionRepo);
const getSessionByIdUseCase = new GetSessionByIdUseCase(sessionRepo);
const getSessionStatusUseCase = new GetSessionStatusUseCase(sessionRepo);
const connectSessionUseCase = new ConnectSessionUseCase(sessionRepo, auditRepo);
const disconnectSessionUseCase = new DisconnectSessionUseCase(sessionRepo, auditRepo);
const reconnectSessionUseCase = new ReconnectSessionUseCase(sessionRepo, auditRepo);
const logoutSessionUseCase = new LogoutSessionUseCase(sessionRepo, authStateRepo, auditRepo);

// Both auth + tenant context required for all session routes
const preHandler = [authHook, tenantHook];
type IdParam = { id: string };

/**
 * Session routes — require authentication AND an active tenant context.
 * All operations are scoped to request.tenantContext.tenantId.
 * Registered under /api/sessions.
 */
export async function sessionRoutes(app: FastifyInstance): Promise<void> {
  // ── POST /sessions — create new session ────────────────────────────────────
  app.post(
    '/',
    { preHandler, schema: { body: createSessionBodySchema } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { tenantId, userId } = request.tenantContext;
      const { name, engine } = request.body as { name: string; engine?: string };

      const session = await createSessionUseCase.execute({ tenantId, userId, name, engine });
      httpResponse.created(reply, SessionPresenter.toSessionItem(session));
    },
  );

  // ── GET /sessions — list sessions for tenant ───────────────────────────────
  app.get(
    '/',
    { preHandler },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { tenantId } = request.tenantContext;
      const sessions = await listSessionsUseCase.execute({ tenantId });
      httpResponse.ok(reply, SessionPresenter.toSessionList(sessions));
    },
  );

  // ── GET /sessions/:id — get session by id ─────────────────────────────────
  app.get(
    '/:id',
    { preHandler, schema: { params: sessionIdParamSchema } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { tenantId } = request.tenantContext;
      const { id } = request.params as IdParam;
      const session = await getSessionByIdUseCase.execute({ sessionId: id, tenantId });
      httpResponse.ok(reply, SessionPresenter.toSessionItem(session));
    },
  );

  // ── GET /sessions/:id/status — get session status ─────────────────────────
  app.get(
    '/:id/status',
    { preHandler, schema: { params: sessionIdParamSchema } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { tenantId } = request.tenantContext;
      const { id } = request.params as IdParam;
      const result = await getSessionStatusUseCase.execute({ sessionId: id, tenantId });
      httpResponse.ok(reply, SessionPresenter.toSessionStatus(result));
    },
  );

  // ── POST /sessions/:id/connect — request connection ───────────────────────
  app.post(
    '/:id/connect',
    { preHandler, schema: { params: sessionIdParamSchema } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { tenantId, userId } = request.tenantContext;
      const { id } = request.params as IdParam;
      const result = await connectSessionUseCase.execute({ sessionId: id, tenantId, userId });
      httpResponse.ok(reply, SessionPresenter.toConnectResult(result));
    },
  );

  // ── POST /sessions/:id/disconnect — request disconnection ─────────────────
  app.post(
    '/:id/disconnect',
    { preHandler, schema: { params: sessionIdParamSchema } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { tenantId, userId } = request.tenantContext;
      const { id } = request.params as IdParam;
      const result = await disconnectSessionUseCase.execute({ sessionId: id, tenantId, userId });
      httpResponse.ok(reply, SessionPresenter.toActionResult(result));
    },
  );

  // ── POST /sessions/:id/reconnect — request reconnection ───────────────────
  app.post(
    '/:id/reconnect',
    { preHandler, schema: { params: sessionIdParamSchema } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { tenantId, userId } = request.tenantContext;
      const { id } = request.params as IdParam;
      const result = await reconnectSessionUseCase.execute({ sessionId: id, tenantId, userId });
      httpResponse.ok(reply, SessionPresenter.toConnectResult(result));
    },
  );

  // ── POST /sessions/:id/logout — logical logout ────────────────────────────
  app.post(
    '/:id/logout',
    { preHandler, schema: { params: sessionIdParamSchema } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { tenantId, userId } = request.tenantContext;
      const { id } = request.params as IdParam;
      const result = await logoutSessionUseCase.execute({ sessionId: id, tenantId, userId });
      httpResponse.ok(reply, SessionPresenter.toActionResult(result));
    },
  );
}
