import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { authHook } from '../../../../shared/http/hooks/authHook';
import { tenantHook } from '../../../../shared/http/hooks/tenantHook';
import { sseAuthHook } from '../../../../shared/http/hooks/sseAuthHook';
import { httpResponse } from '../../../../shared/http/httpResponse';
import { prisma } from '../../../../shared/database/prisma.client';
import { ChatPresenter } from '../presenters/ChatPresenter';
import { internalEventBus } from '../../../../shared/events/InternalEventBus';
import { chatWsPublisher } from '../../infrastructure/ws/ChatWebSocketPublisher';
import { logger } from '../../../../shared/logger/logger';
import {
  conversationIdParamSchema,
  contactIdParamSchema,
  listConversationsQuerySchema,
  listMessagesQuerySchema,
  sendMessageBodySchema,
  updateConversationBodySchema,
} from '../schemas/chat.schema';

// ── Infrastructure ────────────────────────────────────────────────────────────
import { PrismaChatContactRepository } from '../../infrastructure/repositories/PrismaChatContactRepository';
import { PrismaChatConversationRepository } from '../../infrastructure/repositories/PrismaChatConversationRepository';
import { PrismaChatMessageRepository } from '../../infrastructure/repositories/PrismaChatMessageRepository';
import { PrismaSessionRepository } from '../../../sessions/infrastructure/repositories/PrismaSessionRepository';
import { PrismaUserRepository } from '../../../users/infrastructure/repositories/PrismaUserRepository';

// ── Use Cases ─────────────────────────────────────────────────────────────────
import { ListConversationsUseCase } from '../../application/use-cases/ListConversationsUseCase';
import { GetConversationByIdUseCase } from '../../application/use-cases/GetConversationByIdUseCase';
import { UpdateConversationUseCase } from '../../application/use-cases/UpdateConversationUseCase';
import { ListMessagesUseCase } from '../../application/use-cases/ListMessagesUseCase';
import { SendMessageUseCase } from '../../application/use-cases/SendMessageUseCase';
import { GetContactByIdUseCase } from '../../application/use-cases/GetContactByIdUseCase';
import { MarkConversationAsReadUseCase } from '../../application/use-cases/MarkConversationAsReadUseCase';
import { getActiveEngine } from '../../../../shared/engine/activeEngine';

import type { ConversationStatus } from '../../domain/enums/ConversationStatus';

// ── Singletons ────────────────────────────────────────────────────────────────
const contactRepo       = new PrismaChatContactRepository(prisma);
const conversationRepo  = new PrismaChatConversationRepository(prisma);
const messageRepo       = new PrismaChatMessageRepository(prisma);
const sessionRepo       = new PrismaSessionRepository();
const userRepo          = new PrismaUserRepository();

const listConversationsUseCase  = new ListConversationsUseCase(conversationRepo, contactRepo, sessionRepo);
const getConversationUseCase    = new GetConversationByIdUseCase(conversationRepo, contactRepo, sessionRepo, userRepo);
const updateConversationUseCase = new UpdateConversationUseCase(conversationRepo, contactRepo, sessionRepo, userRepo);
const listMessagesUseCase       = new ListMessagesUseCase(messageRepo, conversationRepo);
const getContactUseCase         = new GetContactByIdUseCase(contactRepo);

const preHandler = [authHook, tenantHook];

/**
 * Chat routes — require authentication AND an active tenant context.
 * Registered under /api/chat.
 */
export async function chatRoutes(app: FastifyInstance): Promise<void> {
  // ── GET /conversations ─────────────────────────────────────────────────────
  app.get(
    '/conversations',
    { preHandler, schema: { querystring: listConversationsQuerySchema } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { tenantId } = request.tenantContext;
      const qs = request.query as Record<string, string | undefined>;

      const result = await listConversationsUseCase.execute({
        tenantId,
        search:     qs['search'] || undefined,
        status:     qs['status'] ? (qs['status'] as ConversationStatus) : undefined,
        sessionId:  qs['sessionId'] || undefined,
        unreadOnly: qs['unreadOnly'] === 'true',
      });

      httpResponse.ok(reply, ChatPresenter.presentConversationList(result));
    },
  );

  // ── GET /conversations/:id ─────────────────────────────────────────────────
  app.get(
    '/conversations/:id',
    { preHandler, schema: { params: conversationIdParamSchema } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { tenantId } = request.tenantContext;
      const { id } = request.params as { id: string };
      const result = await getConversationUseCase.execute({ conversationId: id, tenantId });
      httpResponse.ok(reply, ChatPresenter.presentConversation(result));
    },
  );

  // ── PATCH /conversations/:id ───────────────────────────────────────────────
  app.patch(
    '/conversations/:id',
    { preHandler, schema: { params: conversationIdParamSchema, body: updateConversationBodySchema } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { tenantId } = request.tenantContext;
      const { id } = request.params as { id: string };
      const body = request.body as {
        status?:            string;
        assignedUserId?:    string | null;
        queueName?:         string | null;
        tags?:              string[];
        notes?:             string | null;
        autoDownloadMedia?: boolean;
      };

      const result = await updateConversationUseCase.execute({
        conversationId: id,
        tenantId,
        status:            body.status ? (body.status as ConversationStatus) : undefined,
        assignedUserId:    body.assignedUserId,
        queueName:         body.queueName,
        tags:              body.tags,
        notes:             body.notes,
        autoDownloadMedia: body.autoDownloadMedia,
      });

      // Notify WS subscribers of this tenant about the updated conversation
      chatWsPublisher.publish(tenantId, {
        event: 'chat.conversation.updated',
        data: {
          tenantId,
          conversationId: result.id,
          status: result.status,
          assignedUserId: result.assignedUserId ?? null,
          queueName: result.queueName ?? null,
          tags: result.tags,
          notes: result.notes ?? null,
          unreadCount: result.unreadCount,
          lastMessagePreview: result.lastMessagePreview ?? null,
          lastMessageAt: result.lastMessageAt ?? null,
        },
      });

      httpResponse.ok(reply, ChatPresenter.presentConversation(result));
    },
  );

  // ── GET /conversations/:id/messages ───────────────────────────────────────
  app.get(
    '/conversations/:id/messages',
    { preHandler, schema: { params: conversationIdParamSchema, querystring: listMessagesQuerySchema } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { tenantId } = request.tenantContext;
      const { id } = request.params as { id: string };
      const qs = request.query as Record<string, string | undefined>;

      const result = await listMessagesUseCase.execute({
        conversationId: id,
        tenantId,
        limit:  qs['limit'] ? parseInt(qs['limit'], 10) : undefined,
        before: qs['before'],
      });

      httpResponse.ok(reply, ChatPresenter.presentMessageList(result));
    },
  );

  // ── POST /conversations/:id/messages ──────────────────────────────────────
  app.post(
    '/conversations/:id/messages',
    { preHandler, schema: { params: conversationIdParamSchema, body: sendMessageBodySchema } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { tenantId } = request.tenantContext;
      const { id } = request.params as { id: string };
      const { content, quotedMessageId } = request.body as { content: string; quotedMessageId?: string };

      // Instanciado por request para capturar o estado atual da engine
      const sendMessageUseCase = new SendMessageUseCase(messageRepo, conversationRepo, contactRepo, getActiveEngine());
      const result = await sendMessageUseCase.execute({ conversationId: id, tenantId, content, quotedMessageId });
      httpResponse.created(reply, ChatPresenter.presentMessage(result));
    },
  );

  // ── GET /contacts/:contactId ───────────────────────────────────────────────
  app.get(
    '/contacts/:contactId',
    { preHandler, schema: { params: contactIdParamSchema } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { tenantId } = request.tenantContext;
      const { contactId } = request.params as { contactId: string };
      const result = await getContactUseCase.execute({ contactId, tenantId });
      httpResponse.ok(reply, ChatPresenter.presentContact(result));
    },
  );

  // ── POST /conversations/:id/read — marca conversa como lida ───────────────
  app.post(
    '/conversations/:id/read',
    { preHandler, schema: { params: conversationIdParamSchema } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { tenantId } = request.tenantContext;
      const { id } = request.params as { id: string };

      const useCase = new MarkConversationAsReadUseCase(
        conversationRepo,
        contactRepo,
        messageRepo,
        getActiveEngine(),
      );
      await useCase.execute({ conversationId: id, tenantId });

      chatWsPublisher.publish(tenantId, {
        event: 'chat.unread.updated',
        data: { tenantId, conversationId: id, unreadCount: 0 },
      });

      httpResponse.ok(reply, { success: true });
    },
  );

  // ── POST /conversations/:id/presence — subscribe presence for a contact ───
  app.post(
    '/conversations/:id/presence',
    { preHandler, schema: { params: conversationIdParamSchema } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { tenantId } = request.tenantContext;
      const { id } = request.params as { id: string };

      const conversation = await conversationRepo.findById(id, tenantId);
      if (!conversation) {
        return httpResponse.ok(reply, { subscribed: false });
      }

      const engine = getActiveEngine();
      if (!engine || !conversation.sessionId) {
        return httpResponse.ok(reply, { subscribed: false });
      }

      const contact = conversation.contactId
        ? await contactRepo.findById(conversation.contactId, tenantId)
        : null;
      // Para grupos: usa groupJid@g.us; para individuais: usa phone do contato
      const presenceJid = conversation.isGroup && conversation.groupJid
        ? `${conversation.groupJid}@g.us`
        : contact?.phone;
      if (!presenceJid) return httpResponse.ok(reply, { subscribed: false });

      await engine.presenceSubscribe(conversation.sessionId, presenceJid);
      httpResponse.ok(reply, { subscribed: true });
    },
  );

  // ── GET /events  (Server-Sent Events — tempo real) ─────────────────────────
  // Envia eventos do tenant autenticado ao cliente via SSE.
  // Formato: "data: <JSON>\n\n"
  app.get(
    '/events',
    { preHandler: [sseAuthHook] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { tenantId } = request.tenantContext;

      reply.raw.setHeader('Content-Type', 'text/event-stream');
      reply.raw.setHeader('Cache-Control', 'no-cache, no-transform');
      reply.raw.setHeader('Connection', 'keep-alive');
      reply.raw.setHeader('X-Accel-Buffering', 'no');
      reply.raw.flushHeaders();

      const send = (event: string, data: unknown): void => {
        reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      };

      // Keepalive a cada 25s para evitar timeout de proxy/browser
      const keepalive = setInterval(() => {
        reply.raw.write(': ping\n\n');
      }, 25_000);

      const onMessage = (payload: import('../../../../shared/events/InternalMessagingEvent').InternalMessagingEvent): void => {
        if (payload.tenantId !== tenantId) return;

        if (payload.type === 'MESSAGE_RECEIVED') {
          send('message_received', {
            sessionId: payload.sessionId,
            from: payload.from,
            fromName: (payload as { fromName?: string }).fromName,
            body: payload.body,
          });
        }
      };

      internalEventBus.on('MESSAGE_RECEIVED', onMessage as never);

      request.raw.on('close', () => {
        clearInterval(keepalive);
        internalEventBus.off('MESSAGE_RECEIVED', onMessage as never);
        logger.debug({ tenantId }, 'SSE client disconnected');
      });

      logger.debug({ tenantId }, 'SSE client connected');

      // Mantém a conexão aberta indefinidamente
      await new Promise<void>((resolve) => request.raw.on('close', resolve));
    },
  );
}
