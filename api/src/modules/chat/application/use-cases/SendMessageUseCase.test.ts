import { describe, it, expect, vi } from 'vitest';
import { SendMessageUseCase } from './SendMessageUseCase';
import { ChatMessageDirection, ChatMessageType } from '../../domain/enums/ChatMessageEnums';
import { SessionNotConnectedError } from '../../../../shared/errors/internal/SessionErrors';
import type { IChatMessageRepository } from '../../domain/contracts/IChatMessageRepository';
import type { IChatConversationRepository } from '../../domain/contracts/IChatConversationRepository';
import type { IChatContactRepository } from '../../domain/contracts/IChatContactRepository';
import type { IMessagingEngine } from '../../../messaging/domain/contracts/IMessagingEngine';

const TENANT = 'tenant-1';
const CONVERSA = 'conv-1';
const NOW = new Date('2026-09-25T12:00:00.000Z');

function citada(over: Record<string, unknown> = {}) {
  return {
    id: 'msg-citada', tenantId: TENANT, conversationId: CONVERSA,
    direction: ChatMessageDirection.INBOUND, type: ChatMessageType.TEXT,
    content: 'pergunta', mediaUrl: null, externalMessageId: 'EXT-CITADA',
    isDeleted: false, fromParticipant: null,
    ...over,
  };
}

function makeDeps(overrides?: {
  conversation?: Record<string, unknown>;
  quoted?: Record<string, unknown> | null;
  engine?: IMessagingEngine | null;
}) {
  const conversation = {
    id: CONVERSA, tenantId: TENANT, sessionId: 'sess-1',
    isGroup: false, groupJid: null, contactId: 'contact-1',
    ...overrides?.conversation,
  };

  const messageRepo = {
    findById: vi.fn().mockResolvedValue(overrides?.quoted === undefined ? citada() : overrides.quoted),
    create: vi.fn().mockImplementation(async (data: Record<string, unknown>) => ({
      id: 'msg-nova', tenantId: TENANT, conversationId: CONVERSA,
      direction: data.direction, type: data.type, content: data.content,
      mediaUrl: null, mimeType: null, fileName: null, durationSeconds: null,
      externalMessageId: data.externalMessageId ?? null, status: 'SENT', isDeleted: false,
      quotedMessageId: data.quotedMessageId ?? null, sentAt: NOW,
      fromParticipant: null, fromParticipantName: null, createdAt: NOW,
    })),
  } as unknown as IChatMessageRepository;
  const conversationRepo = {
    findById: vi.fn().mockResolvedValue(conversation),
    updateLastMessage: vi.fn().mockResolvedValue(undefined),
  } as unknown as IChatConversationRepository;
  const contactRepo = {
    findById: vi.fn().mockResolvedValue({ id: 'contact-1', phone: '5511999999999' }),
  } as unknown as IChatContactRepository;

  const engine = overrides?.engine === undefined
    ? ({ sendTextMessage: vi.fn().mockResolvedValue({ messageId: 'EXT-NOVA', sentAt: NOW }) } as unknown as IMessagingEngine)
    : overrides.engine;

  const useCase = new SendMessageUseCase(messageRepo, conversationRepo, contactRepo, engine);
  return { useCase, messageRepo, engine };
}

const enviar = (d: ReturnType<typeof makeDeps>, quotedMessageId: string | null = 'msg-citada') =>
  d.useCase.execute({ conversationId: CONVERSA, tenantId: TENANT, content: 'resposta', quotedMessageId });

const engineInput = (d: ReturnType<typeof makeDeps>) => vi.mocked(d.engine!.sendTextMessage).mock.calls[0][0];
const created = (d: ReturnType<typeof makeDeps>) => vi.mocked(d.messageRepo.create).mock.calls[0][0];

describe('SendMessageUseCase — citação', () => {
  it('resposta em conversa individual leva a citada à engine e grava o vínculo', async () => {
    const d = makeDeps();
    const dto = await enviar(d);

    expect(engineInput(d)).toMatchObject({
      to: '5511999999999',
      body: 'resposta',
      quotedMessage: {
        externalId: 'EXT-CITADA', remoteJid: '5511999999999', fromMe: false,
        body: 'pergunta', type: ChatMessageType.TEXT,
      },
    });
    expect(engineInput(d).quotedMessage).not.toHaveProperty('participant');
    expect(created(d).quotedMessageId).toBe('msg-citada');
    expect(dto.quotedMessage?.id).toBe('msg-citada');
  });

  it('resposta em grupo a mensagem de outro autor leva o autor', async () => {
    const d = makeDeps({
      conversation: { isGroup: true, groupJid: '120363000000000000', contactId: null },
      quoted: citada({ fromParticipant: '5551804625870' }),
    });
    await enviar(d);

    expect(engineInput(d).to).toBe('120363000000000000@g.us');
    expect(engineInput(d).quotedMessage).toMatchObject({
      remoteJid: '120363000000000000@g.us',
      participant: '5551804625870',
    });
  });

  it('resposta a mídia leva os metadados da citada para o preview no WhatsApp', async () => {
    const d = makeDeps({
      quoted: citada({ type: ChatMessageType.AUDIO, content: null, mimeType: 'audio/ogg; codecs=opus', durationSeconds: 9 }),
    });
    await enviar(d);

    expect(engineInput(d).quotedMessage).toMatchObject({
      type: ChatMessageType.AUDIO, mimeType: 'audio/ogg; codecs=opus', durationSeconds: 9,
    });
  });

  it('citada de outra conversa não é citada nem vinculada', async () => {
    const d = makeDeps({ quoted: citada({ conversationId: 'conv-outra' }) });
    const dto = await enviar(d);

    expect(engineInput(d).quotedMessage).toBeNull();
    expect(created(d).quotedMessageId).toBeNull();
    expect(dto.quotedMessage).toBeNull();
  });

  it('citada que nunca chegou ao WhatsApp segue sem citação na engine, mantendo o vínculo', async () => {
    const d = makeDeps({ quoted: citada({ externalMessageId: null }) });
    await enviar(d);

    expect(engineInput(d).quotedMessage).toBeNull();
    expect(created(d).quotedMessageId).toBe('msg-citada');
  });

  it('citada inexistente segue sem citação e sem vínculo', async () => {
    // O create resolveria o id também por externalMessageId em todo o tenant: repassar o id
    // de uma citada não encontrada podia ligar a resposta a uma mensagem de outro chat.
    const d = makeDeps({ quoted: null });
    const dto = await enviar(d);

    expect(engineInput(d).quotedMessage).toBeNull();
    expect(created(d).quotedMessageId).toBeNull();
    expect(dto.quotedMessage).toBeNull();
  });

  it('citada apagada não vai ao WhatsApp, mas o vínculo no painel continua', async () => {
    const d = makeDeps({ quoted: citada({ isDeleted: true, content: null }) });
    const dto = await enviar(d);

    expect(engineInput(d).quotedMessage).toBeNull();
    expect(created(d).quotedMessageId).toBe('msg-citada');
    expect(dto.quotedMessage).toMatchObject({ id: 'msg-citada', isDeleted: true });
  });

  it('mensagem sem resposta não consulta citada', async () => {
    const d = makeDeps();
    await enviar(d, null);

    expect(d.messageRepo.findById).not.toHaveBeenCalled();
    expect(engineInput(d).quotedMessage).toBeNull();
    expect(created(d).quotedMessageId).toBeNull();
  });
});

describe('SendMessageUseCase — envio (comportamento mantido)', () => {
  it('grava com o id externo devolvido pela engine', async () => {
    const d = makeDeps();
    await enviar(d, null);

    expect(created(d)).toMatchObject({
      direction: ChatMessageDirection.OUTBOUND,
      type: ChatMessageType.TEXT,
      content: 'resposta',
      externalMessageId: 'EXT-NOVA',
    });
  });

  it('erro da engine propaga e nada é gravado', async () => {
    const engine = {
      sendTextMessage: vi.fn().mockRejectedValue(new SessionNotConnectedError('sess-1')),
    } as unknown as IMessagingEngine;
    const d = makeDeps({ engine });

    await expect(enviar(d)).rejects.toBeInstanceOf(SessionNotConnectedError);
    expect(d.messageRepo.create).not.toHaveBeenCalled();
  });

  it('sem engine grava sem id externo (fallback existente)', async () => {
    const d = makeDeps({ engine: null });
    await enviar(d, null);

    expect(created(d).externalMessageId).toBeNull();
  });
});
