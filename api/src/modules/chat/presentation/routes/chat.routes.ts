import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { authHook } from '../../../../shared/http/hooks/authHook';
import { tenantHook } from '../../../../shared/http/hooks/tenantHook';
import { sseAuthHook } from '../../../../shared/http/hooks/sseAuthHook';
import { UpdateConversationStateUseCase } from '../../application/use-cases/UpdateConversationStateUseCase';
import { SuggestContactsUseCase } from '../../application/use-cases/SuggestContactsUseCase';
import { StartConversationUseCase } from '../../application/use-cases/StartConversationUseCase';
import { SyncChatAvatarsUseCase } from '../../application/use-cases/SyncChatAvatarsUseCase';
import { ListGroupParticipantsUseCase } from '../../application/use-cases/ListGroupParticipantsUseCase';
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
  startConversationBodySchema,
  suggestContactsQuerySchema,
  listParticipantsQuerySchema,
  conversationStateBodySchema,
  sendMessageBodySchema,
  messageIdParamSchema,
  reactionBodySchema,
  updateConversationBodySchema,
} from '../schemas/chat.schema';

// ── Infrastructure ────────────────────────────────────────────────────────────
import { PrismaChatContactRepository } from '../../infrastructure/repositories/PrismaChatContactRepository';
import { PrismaChatConversationRepository } from '../../infrastructure/repositories/PrismaChatConversationRepository';
import { PrismaChatMessageRepository } from '../../infrastructure/repositories/PrismaChatMessageRepository';
import { PrismaChatMessageReactionRepository } from '../../infrastructure/repositories/PrismaChatMessageReactionRepository';
import { PrismaSessionRepository } from '../../../sessions/infrastructure/repositories/PrismaSessionRepository';
import { PrismaUserRepository } from '../../../users/infrastructure/repositories/PrismaUserRepository';

// ── Use Cases ─────────────────────────────────────────────────────────────────
import { ListConversationsUseCase } from '../../application/use-cases/ListConversationsUseCase';
import { GetConversationByIdUseCase } from '../../application/use-cases/GetConversationByIdUseCase';
import { UpdateConversationUseCase } from '../../application/use-cases/UpdateConversationUseCase';
import { ListMessagesUseCase } from '../../application/use-cases/ListMessagesUseCase';
import { SendMessageUseCase } from '../../application/use-cases/SendMessageUseCase';
import { SetMessageReactionUseCase } from '../../application/use-cases/SetMessageReactionUseCase';
import { InMemoryReactionSendThrottle } from '../../infrastructure/throttle/InMemoryReactionSendThrottle';
import type { IReactionUpdatePublisher } from '../../application/contracts/IReactionUpdatePublisher';
import { env } from '../../../../shared/config/env';
import { GetContactByIdUseCase } from '../../application/use-cases/GetContactByIdUseCase';
import { MarkConversationAsReadUseCase } from '../../application/use-cases/MarkConversationAsReadUseCase';
import { getActiveEngine } from '../../../../shared/engine/activeEngine';

import type { ConversationStatus } from '../../domain/enums/ConversationStatus';

// ── Singletons ────────────────────────────────────────────────────────────────
const contactRepo       = new PrismaChatContactRepository(prisma);
const conversationRepo  = new PrismaChatConversationRepository(prisma);
const messageRepo       = new PrismaChatMessageRepository(prisma);
const reactionRepo      = new PrismaChatMessageReactionRepository(prisma);
const sessionRepo       = new PrismaSessionRepository();
const userRepo          = new PrismaUserRepository();

const listConversationsUseCase  = new ListConversationsUseCase(conversationRepo, contactRepo, sessionRepo);
const getConversationUseCase    = new GetConversationByIdUseCase(conversationRepo, contactRepo, sessionRepo, userRepo);
const updateConversationUseCase = new UpdateConversationUseCase(conversationRepo, contactRepo, sessionRepo, userRepo);
const listMessagesUseCase       = new ListMessagesUseCase(messageRepo, conversationRepo, contactRepo, reactionRepo);
const getContactUseCase         = new GetContactByIdUseCase(contactRepo);

// Instância única no módulo: uma por requisição zeraria o limite de envio de reações.
const reactionThrottle = new InMemoryReactionSendThrottle({
  minIntervalMs: env.REACTION_MIN_INTERVAL_MS,
  maxPerMinute:  env.REACTION_MAX_PER_MINUTE,
});
const reactionPublisher: IReactionUpdatePublisher = {
  publishReactionUpdated: (data) =>
    chatWsPublisher.publish(data.tenantId, { event: 'chat.message.reaction.updated', data }),
};

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
        archived:   qs['archived'] === 'true',
      });

      // A contagem acompanha a listagem para o painel exibir "Arquivadas · N" sem
      // precisar de uma chamada extra.
      const archivedCount = await conversationRepo.countArchived(
        tenantId,
        qs['sessionId'] || undefined,
      );

      httpResponse.ok(reply, {
        conversations: ChatPresenter.presentConversationList(result),
        archivedCount,
      });
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
        search: qs['search'] || undefined,
        around: qs['around'] || undefined,
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

  // ── PUT /messages/:messageId/reaction ─────────────────────────────────────
  // Idempotente: aplica a nossa reação ou, com `emoji: null`, remove.
  app.put(
    '/messages/:messageId/reaction',
    { preHandler, schema: { params: messageIdParamSchema, body: reactionBodySchema } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { tenantId } = request.tenantContext;
      const { messageId } = request.params as { messageId: string };
      const { emoji } = request.body as { emoji: string | null };

      // Instanciado por request para capturar o estado atual da engine; o limite é compartilhado.
      const useCase = new SetMessageReactionUseCase(
        messageRepo, conversationRepo, contactRepo, reactionRepo,
        getActiveEngine(), reactionThrottle, reactionPublisher,
      );
      const result = await useCase.execute({ tenantId, messageId, emoji });
      httpResponse.ok(reply, ChatPresenter.presentReactionResult(result));
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

  // ── PATCH /conversations/:id/state — arquivar, fixar, silenciar, etc. ─────
  app.patch(
    '/conversations/:id/state',
    { preHandler, schema: { params: conversationIdParamSchema, body: conversationStateBodySchema } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { tenantId } = request.tenantContext;
      const { id } = request.params as { id: string };
      const body = request.body as {
        archived?: boolean; pinned?: boolean; muteMs?: number | null;
        favorite?: boolean; unread?: boolean; lists?: string[];
      };

      const useCase = new UpdateConversationStateUseCase(
        conversationRepo, contactRepo, messageRepo, getActiveEngine() ?? undefined,
      );
      const state = await useCase.execute({ tenantId, conversationId: id, ...body });

      // Anuncia às demais abas e aos outros operadores do tenant. syncedToWhatsApp fica
      // de fora: descreve a tentativa de sincronização, não o estado da conversa — e a
      // mudança local vale mesmo quando a sessão está fora do ar.
      chatWsPublisher.publish(tenantId, {
        event: 'chat.state.updated',
        data: {
          tenantId,
          conversationId: id,
          archived: state.archived,
          pinned: state.pinned,
          mutedUntil: state.mutedUntil,
          manuallyUnread: state.manuallyUnread,
          favorite: state.favorite,
          lists: state.lists,
        },
      });

      httpResponse.ok(reply, state);
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

      // manuallyUnread acompanha o contador: sem ele, as demais abas seguiriam
      // destacando a conversa depois que esta a marcou como lida.
      chatWsPublisher.publish(tenantId, {
        event: 'chat.unread.updated',
        data: { tenantId, conversationId: id, unreadCount: 0, manuallyUnread: false },
      });

      httpResponse.ok(reply, { success: true });
    },
  );

  // ── GET /contacts/suggest — sugestões ao iniciar uma conversa ─────────────
  app.get(
    '/contacts/suggest',
    { preHandler, schema: { querystring: suggestContactsQuerySchema } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { tenantId } = request.tenantContext;
      const qs = request.query as Record<string, string | undefined>;

      const useCase = new SuggestContactsUseCase(contactRepo, getActiveEngine() ?? undefined);
      const suggestions = await useCase.execute({
        tenantId,
        term: qs['q'] ?? '',
        sessionId: qs['sessionId'] || undefined,
      });

      httpResponse.ok(reply, { suggestions });
    },
  );

  // ── POST /conversations — abre (ou reaproveita) conversa com um contato ───
  app.post(
    '/conversations',
    { preHandler, schema: { body: startConversationBodySchema } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { tenantId } = request.tenantContext;
      const body = request.body as { sessionId: string; phone: string; name?: string };

      const useCase = new StartConversationUseCase(conversationRepo, contactRepo, sessionRepo);
      const result = await useCase.execute({
        tenantId,
        sessionId: body.sessionId,
        phone: body.phone,
        name: body.name,
      });

      reply.status(result.created ? 201 : 200);
      httpResponse.ok(reply, result);
    },
  );

  // ── POST /avatars/sync — preenche avatares faltantes em lote ──────────────
  app.post(
    '/avatars/sync',
    { preHandler },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { tenantId } = request.tenantContext;

      const engine = getActiveEngine();
      if (!engine) return httpResponse.ok(reply, { updated: 0, remaining: 0 });

      const useCase = new SyncChatAvatarsUseCase(conversationRepo, contactRepo, engine);
      const result = await useCase.execute({ tenantId });

      httpResponse.ok(reply, result);
    },
  );

  // ── GET /conversations/:id/participants — membros do grupo, paginados ─────
  app.get(
    '/conversations/:id/participants',
    { preHandler, schema: { params: conversationIdParamSchema, querystring: listParticipantsQuerySchema } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { tenantId } = request.tenantContext;
      const { id } = request.params as { id: string };
      const qs = request.query as Record<string, string | undefined>;

      const engine = getActiveEngine();
      if (!engine) return httpResponse.ok(reply, { participants: [], total: 0, nextCursor: null });

      const useCase = new ListGroupParticipantsUseCase(conversationRepo, contactRepo, engine);
      const result = await useCase.execute({
        conversationId: id,
        tenantId,
        cursor: qs['cursor'] || undefined,
        search: qs['search'] || undefined,
      });

      httpResponse.ok(reply, result);
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
