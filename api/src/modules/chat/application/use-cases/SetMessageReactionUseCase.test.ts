import { describe, it, expect, vi } from 'vitest';
import { SetMessageReactionUseCase } from './SetMessageReactionUseCase';
import { ChatMessageDirection } from '../../domain/enums/ChatMessageEnums';
import { InMemoryReactionSendThrottle } from '../../infrastructure/throttle/InMemoryReactionSendThrottle';
import {
  ConflictError,
  TooManyRequestsError,
  ValidationError,
} from '../../../../shared/errors/internal/ResourceErrors';
import { SessionNotConnectedError } from '../../../../shared/errors/internal/SessionErrors';
import { MessageSendFailedError } from '../../../../shared/errors/internal/MessagingErrors';
import type { IChatMessageRepository } from '../../domain/contracts/IChatMessageRepository';
import type { IChatConversationRepository } from '../../domain/contracts/IChatConversationRepository';
import type { IChatContactRepository } from '../../domain/contracts/IChatContactRepository';
import type { IChatMessageReactionRepository } from '../../domain/contracts/IChatMessageReactionRepository';
import type { IMessagingEngine } from '../../../messaging/domain/contracts/IMessagingEngine';
import type { IReactionSendThrottle } from '../contracts/IReactionSendThrottle';
import type { IReactionUpdatePublisher } from '../contracts/IReactionUpdatePublisher';

const TENANT = 'tenant-1';
const NOW = new Date('2026-09-24T12:00:00.000Z');

function makeDeps(overrides?: {
  message?: Record<string, unknown>;
  conversation?: Record<string, unknown>;
  engine?: IMessagingEngine | null;
  changed?: boolean;
  throttle?: IReactionSendThrottle;
}) {
  const message = {
    id: 'msg-1', tenantId: TENANT, conversationId: 'conv-1',
    direction: ChatMessageDirection.INBOUND, externalMessageId: 'ext-1',
    isDeleted: false, fromParticipant: null, content: 'oi', type: 'TEXT',
    ...overrides?.message,
  };
  const conversation = {
    id: 'conv-1', tenantId: TENANT, sessionId: 'sess-1',
    isGroup: false, groupJid: null, contactId: 'contact-1',
    ...overrides?.conversation,
  };

  const messageRepo = { findById: vi.fn().mockResolvedValue(message) } as unknown as IChatMessageRepository;
  const conversationRepo = { findById: vi.fn().mockResolvedValue(conversation) } as unknown as IChatConversationRepository;
  const contactRepo = {
    findById: vi.fn().mockResolvedValue({ id: 'contact-1', phone: '5511999999999' }),
    findByPhones: vi.fn().mockResolvedValue([]),
  } as unknown as IChatContactRepository;

  const row = {
    id: 'r1', tenantId: TENANT, messageId: 'msg-1', emoji: '👍', reactorKey: 'self',
    reactorPhone: null, reactorName: null, fromMe: true, externalId: null,
    reactedAt: NOW, createdAt: NOW, updatedAt: NOW,
  };
  const reactionRepo = {
    apply: vi.fn().mockResolvedValue({ applied: true, changed: overrides?.changed ?? true }),
    findByMessageId: vi.fn().mockResolvedValue([row]),
  } as unknown as IChatMessageReactionRepository;

  const engine = overrides?.engine === undefined
    ? ({ sendReaction: vi.fn().mockResolvedValue({ messageId: 'react-1', sentAt: NOW }) } as unknown as IMessagingEngine)
    : overrides.engine;

  const throttle = overrides?.throttle
    ?? new InMemoryReactionSendThrottle({ minIntervalMs: 700, maxPerMinute: 30, now: () => NOW.getTime() });
  const publisher = { publishReactionUpdated: vi.fn() } as IReactionUpdatePublisher;

  const useCase = new SetMessageReactionUseCase(
    messageRepo, conversationRepo, contactRepo, reactionRepo, engine, throttle, publisher, () => NOW,
  );
  return { useCase, messageRepo, reactionRepo, engine, publisher, throttle };
}

const run = (d: ReturnType<typeof makeDeps>, emoji: string | null = '👍') =>
  d.useCase.execute({ tenantId: TENANT, messageId: 'msg-1', emoji });

describe('SetMessageReactionUseCase', () => {
  it('emoji válido: envia e grava com o mesmo carimbo, publica e devolve o agregado', async () => {
    const d = makeDeps();
    const out = await run(d);

    const sent = vi.mocked(d.engine!.sendReaction).mock.calls[0][0];
    const applied = vi.mocked(d.reactionRepo.apply).mock.calls[0][0];
    expect(sent).toMatchObject({
      sessionId: 'sess-1', tenantId: TENANT, emoji: '👍',
      target: { externalId: 'ext-1', remoteJid: '5511999999999', fromMe: false },
    });
    expect(applied).toMatchObject({ reactorKey: 'self', fromMe: true, emoji: '👍', messageId: 'msg-1' });
    expect(applied.reactedAt).toBe(sent.reactedAt);
    expect(applied.reactedAt).toEqual(NOW);

    expect(out).toEqual({
      conversationId: 'conv-1', messageId: 'msg-1', reactionsRevision: NOW.toISOString(),
      reactions: [{ emoji: '👍', count: 1, reactedByMe: true, reactors: [{ name: null, phone: null, isMe: true }] }],
    });
    expect(d.publisher.publishReactionUpdated).toHaveBeenCalledWith({ tenantId: TENANT, ...out });
  });

  it('mensagem enviada por nós vira alvo fromMe', async () => {
    const d = makeDeps({ message: { direction: ChatMessageDirection.OUTBOUND } });
    await run(d);
    expect(vi.mocked(d.engine!.sendReaction).mock.calls[0][0].target.fromMe).toBe(true);
  });

  it('engine falha: nada é gravado e a nova tentativa imediata recebe o erro da engine, não 429', async () => {
    const engine = {
      sendReaction: vi.fn().mockRejectedValue(new MessageSendFailedError('session dropped')),
    } as unknown as IMessagingEngine;
    const d = makeDeps({ engine });

    await expect(run(d)).rejects.toBeInstanceOf(MessageSendFailedError);
    await expect(run(d)).rejects.toBeInstanceOf(MessageSendFailedError);

    expect(engine.sendReaction).toHaveBeenCalledTimes(2);
    expect(d.reactionRepo.apply).not.toHaveBeenCalled();
    expect(d.publisher.publishReactionUpdated).not.toHaveBeenCalled();
  });

  it('limite estourado: 429 e a engine não é chamada', async () => {
    const throttle: IReactionSendThrottle = { tryAcquire: vi.fn().mockReturnValue(null), release: vi.fn() };
    const d = makeDeps({ throttle });

    await expect(run(d)).rejects.toBeInstanceOf(TooManyRequestsError);
    expect(d.engine!.sendReaction).not.toHaveBeenCalled();
    expect(d.reactionRepo.apply).not.toHaveBeenCalled();
  });

  it('segunda reação na mesma mensagem logo em seguida é recusada pelo limite', async () => {
    const d = makeDeps();
    await run(d);
    await expect(run(d, '❤️')).rejects.toMatchObject({ code: 'TOO_MANY_REQUESTS', statusCode: 429 });
  });

  it('sem engine: sessão não conectada, nada enviado nem gravado', async () => {
    const d = makeDeps({ engine: null });
    await expect(run(d)).rejects.toBeInstanceOf(SessionNotConnectedError);
    expect(d.reactionRepo.apply).not.toHaveBeenCalled();
  });

  it('conversa sem sessão: sessão não conectada, nada enviado nem gravado', async () => {
    const d = makeDeps({ conversation: { sessionId: null } });
    await expect(run(d)).rejects.toBeInstanceOf(SessionNotConnectedError);
    expect(d.engine!.sendReaction).not.toHaveBeenCalled();
    expect(d.reactionRepo.apply).not.toHaveBeenCalled();
  });

  it('mensagem sem externalMessageId: conflito', async () => {
    const d = makeDeps({ message: { externalMessageId: null } });
    await expect(run(d)).rejects.toBeInstanceOf(ConflictError);
    expect(d.engine!.sendReaction).not.toHaveBeenCalled();
  });

  it('mensagem apagada: conflito', async () => {
    const d = makeDeps({ message: { isDeleted: true } });
    await expect(run(d)).rejects.toBeInstanceOf(ConflictError);
    expect(d.engine!.sendReaction).not.toHaveBeenCalled();
  });

  it('emoji null: envia remoção e grava tombstone', async () => {
    const d = makeDeps();
    await run(d, null);
    expect(vi.mocked(d.engine!.sendReaction).mock.calls[0][0].emoji).toBeNull();
    expect(vi.mocked(d.reactionRepo.apply).mock.calls[0][0].emoji).toBeNull();
  });

  it.each(['abc', ' ', '', '👍 ', '\u0007👍'])('emoji inválido %j: erro de validação antes da engine', async (emoji) => {
    const d = makeDeps();
    await expect(run(d, emoji)).rejects.toBeInstanceOf(ValidationError);
    expect(d.engine!.sendReaction).not.toHaveBeenCalled();
    expect(d.reactionRepo.apply).not.toHaveBeenCalled();
  });

  it('emoji acima de 64 bytes: erro de validação', async () => {
    const d = makeDeps();
    await expect(run(d, '😀'.repeat(17))).rejects.toBeInstanceOf(ValidationError);
  });

  it.each([
    ['família com ZWJ', '👨‍👩‍👧‍👦'],
    ['tom de pele', '👍🏽'],
    ['keycap', '1️⃣'],
    ['bandeira com tag sequence', '🏴󠁧󠁢󠁳󠁣󠁴󠁿'],
  ])('aceita %s', async (_label, emoji) => {
    const d = makeDeps();
    await run(d, emoji);
    expect(vi.mocked(d.engine!.sendReaction).mock.calls[0][0].emoji).toBe(emoji);
  });

  it('grupo: alvo de terceiro leva o participante e o JID do grupo', async () => {
    const d = makeDeps({
      conversation: { isGroup: true, groupJid: '1203630', contactId: null },
      message: { fromParticipant: '5511888888888' },
    });
    await run(d);
    expect(vi.mocked(d.engine!.sendReaction).mock.calls[0][0].target).toEqual({
      externalId: 'ext-1', remoteJid: '1203630@g.us', fromMe: false, participant: '5511888888888',
    });
  });

  it('grupo: alvo de terceiro sem participante é conflito, nada enviado', async () => {
    const d = makeDeps({ conversation: { isGroup: true, groupJid: '1203630', contactId: null } });
    await expect(run(d)).rejects.toBeInstanceOf(ConflictError);
    expect(d.engine!.sendReaction).not.toHaveBeenCalled();
  });

  it('apply sem mudança visível: não publica, mas devolve o agregado', async () => {
    const d = makeDeps({ changed: false });
    const out = await run(d);
    expect(d.publisher.publishReactionUpdated).not.toHaveBeenCalled();
    expect(out.reactionsRevision).toBe(NOW.toISOString());
    expect(out.reactions).toHaveLength(1);
  });
});
