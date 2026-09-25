import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { chatRoutes } from './chat.routes';
import { ChatPresenter } from '../presenters/ChatPresenter';
import { SendMessageUseCase } from '../../application/use-cases/SendMessageUseCase';
import { SendMediaMessageUseCase } from '../../application/use-cases/SendMediaMessageUseCase';
import { RetryOutboundMediaUseCase } from '../../application/use-cases/RetryOutboundMediaUseCase';
import type { ChatMessageDto } from '../../application/use-cases/ListMessagesUseCase';
import {
  ChatMessageDirection,
  ChatMessageStatus,
  ChatMessageType,
} from '../../domain/enums/ChatMessageEnums';
import { errorHandler } from '../../../../shared/http/errorHandler';

/*
 * Exceção justificada à matriz do TESTING.md (como a T15): o que se testa aqui é o contrato
 * HTTP — 202 vs 200, envelope, validação do corpo — e isso só aparece com o Fastify de verdade.
 * Nenhum banco: o cliente Prisma é um objeto vazio, autenticação e tenant são hooks falsos e os
 * use cases são espionados no protótipo (a regra deles tem teste próprio).
 */
vi.mock('../../../../shared/database/prisma.client', () => ({ prisma: {} }));
vi.mock('../../../../shared/http/hooks/authHook', () => ({
  authHook: async (request: { user?: unknown }) => {
    request.user = { userId: 'user-a', isSuperAdmin: false };
  },
}));
vi.mock('../../../../shared/http/hooks/tenantHook', () => ({
  tenantHook: async (request: { tenantContext?: unknown }) => {
    request.tenantContext = { userId: 'user-a', tenantId: 'tenant-a', role: 'ADMIN', isSuperAdmin: false };
  },
}));

const PREFIX = '/api/chat';
const UPLOAD_ID = '1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed';

function mensagem(over: Partial<ChatMessageDto> = {}): ChatMessageDto {
  return {
    id: 'msg-1', conversationId: 'conv-1', tenantId: 'tenant-a',
    direction: ChatMessageDirection.OUTBOUND, type: ChatMessageType.IMAGE,
    content: 'legenda', mediaUrl: '/media/sess-1/ext-1.jpg', mimeType: 'image/jpeg',
    fileName: null, durationSeconds: null, externalMessageId: 'ext-1',
    status: ChatMessageStatus.PENDING, isDeleted: false, quotedMessageId: null, quotedMessage: null,
    sentAt: null, createdAt: '2026-09-25T12:00:00.000Z',
    fromParticipant: null, fromParticipantName: null, fromParticipantAvatarUrl: null,
    reactionsRevision: null, reactions: [],
    ...over,
  };
}

/** O que o presenter produz, depois de passar pelo JSON da resposta. */
function apresentada(dto: ChatMessageDto): unknown {
  return JSON.parse(JSON.stringify(ChatPresenter.presentMessage(dto)));
}

let app: FastifyInstance;

beforeEach(async () => {
  app = Fastify();
  app.setErrorHandler(errorHandler);
  await app.register(chatRoutes, { prefix: PREFIX });
  await app.ready();
});

afterEach(async () => {
  await app.close();
});

describe('POST /conversations/:id/messages/media', () => {
  it('upload novo responde 202 com a mensagem pendente no envelope de sempre', async () => {
    const dto = mensagem();
    const execute = vi.spyOn(SendMediaMessageUseCase.prototype, 'execute')
      .mockResolvedValue({ message: dto, replayed: false });

    const res = await app.inject({
      method: 'POST',
      url: `${PREFIX}/conversations/conv-1/messages/media`,
      payload: { uploadId: UPLOAD_ID, caption: 'legenda', quotedMessageId: 'msg-0' },
    });

    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({ success: true, data: apresentada(dto) });
    expect(execute).toHaveBeenCalledWith({
      tenantId: 'tenant-a',
      userId: 'user-a',
      conversationId: 'conv-1',
      uploadId: UPLOAD_ID,
      caption: 'legenda',
      quotedMessageId: 'msg-0',
    });
  });

  it('confirmação repetida do mesmo upload responde 200 com a mesma mensagem', async () => {
    const dto = mensagem({ status: ChatMessageStatus.SENT });
    vi.spyOn(SendMediaMessageUseCase.prototype, 'execute').mockResolvedValue({ message: dto, replayed: true });

    const res = await app.inject({
      method: 'POST',
      url: `${PREFIX}/conversations/conv-1/messages/media`,
      payload: { uploadId: UPLOAD_ID },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ success: true, data: apresentada(dto) });
  });

  it.each([
    ['fora do formato', 'nao-e-uuid'],
    ['em maiúsculas', UPLOAD_ID.toUpperCase()],
    ['com travessia de caminho', `../${UPLOAD_ID}`],
  ])('uploadId %s responde 400 sem chegar ao envio', async (_caso, uploadId) => {
    const execute = vi.spyOn(SendMediaMessageUseCase.prototype, 'execute');

    const res = await app.inject({
      method: 'POST',
      url: `${PREFIX}/conversations/conv-1/messages/media`,
      payload: { uploadId },
    });

    expect(res.statusCode).toBe(400);
    expect(execute).not.toHaveBeenCalled();
  });

  it('legenda acima de 4096 caracteres responde 400', async () => {
    const execute = vi.spyOn(SendMediaMessageUseCase.prototype, 'execute');

    const res = await app.inject({
      method: 'POST',
      url: `${PREFIX}/conversations/conv-1/messages/media`,
      payload: { uploadId: UPLOAD_ID, caption: 'a'.repeat(4097) },
    });

    expect(res.statusCode).toBe(400);
    expect(execute).not.toHaveBeenCalled();
  });
});

describe('POST /messages/:messageId/retry', () => {
  it('reenvio aceito responde 202 com a mensagem de volta a pendente', async () => {
    const dto = mensagem({ status: ChatMessageStatus.PENDING });
    const execute = vi.spyOn(RetryOutboundMediaUseCase.prototype, 'execute').mockResolvedValue(dto);

    const res = await app.inject({ method: 'POST', url: `${PREFIX}/messages/msg-1/retry` });

    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({ success: true, data: apresentada(dto) });
    expect(execute).toHaveBeenCalledWith({ tenantId: 'tenant-a', messageId: 'msg-1' });
  });
});

describe('POST /conversations/:id/messages (texto)', () => {
  it('continua respondendo 201 com a mensagem no envelope de sempre', async () => {
    const dto = mensagem({
      type: ChatMessageType.TEXT, content: 'oi', mediaUrl: null, mimeType: null,
      status: ChatMessageStatus.SENT,
    });
    const execute = vi.spyOn(SendMessageUseCase.prototype, 'execute').mockResolvedValue(dto);

    const res = await app.inject({
      method: 'POST',
      url: `${PREFIX}/conversations/conv-1/messages`,
      payload: { content: 'oi', quotedMessageId: 'msg-0' },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ success: true, data: apresentada(dto) });
    expect(execute).toHaveBeenCalledWith({
      conversationId: 'conv-1', tenantId: 'tenant-a', content: 'oi', quotedMessageId: 'msg-0',
    });
  });

  it('continua recusando corpo sem conteúdo com 400', async () => {
    const execute = vi.spyOn(SendMessageUseCase.prototype, 'execute');

    const res = await app.inject({
      method: 'POST',
      url: `${PREFIX}/conversations/conv-1/messages`,
      payload: { content: '' },
    });

    expect(res.statusCode).toBe(400);
    expect(execute).not.toHaveBeenCalled();
  });
});
