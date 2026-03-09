import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { authHook } from '../../../../shared/http/hooks/authHook';
import { tenantHook } from '../../../../shared/http/hooks/tenantHook';
import { httpResponse } from '../../../../shared/http/httpResponse';
import { prisma } from '../../../../shared/database/prisma.client';
import { ChatPresenter } from '../presenters/ChatPresenter';
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
const sendMessageUseCase        = new SendMessageUseCase(messageRepo, conversationRepo);
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
        status?:         string;
        assignedUserId?: string | null;
        queueName?:      string | null;
        tags?:           string[];
        notes?:          string | null;
      };

      const result = await updateConversationUseCase.execute({
        conversationId: id,
        tenantId,
        status:         body.status ? (body.status as ConversationStatus) : undefined,
        assignedUserId: body.assignedUserId,
        queueName:      body.queueName,
        tags:           body.tags,
        notes:          body.notes,
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
      const { content } = request.body as { content: string };

      const result = await sendMessageUseCase.execute({ conversationId: id, tenantId, content });
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
}
