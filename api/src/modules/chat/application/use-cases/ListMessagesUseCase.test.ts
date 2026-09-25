import { describe, it, expect, vi } from 'vitest';
import { ListMessagesUseCase } from './ListMessagesUseCase';
import type { IChatMessageRepository } from '../../domain/contracts/IChatMessageRepository';
import type { IChatConversationRepository } from '../../domain/contracts/IChatConversationRepository';
import type { IChatContactRepository } from '../../domain/contracts/IChatContactRepository';
import type { IChatMessageReactionRepository } from '../../domain/contracts/IChatMessageReactionRepository';
import type { ChatMessageReaction } from '../../domain/entities/ChatMessageReaction';

const TENANT = 'tenant-1';
const CONV = 'conv-1';
const T = new Date('2026-09-24T12:00:00.000Z');

function message(id: string, fromParticipant: string | null) {
  return {
    id, conversationId: CONV, tenantId: TENANT, direction: 'INBOUND', type: 'TEXT',
    content: 'oi', mediaUrl: null, mimeType: null, fileName: null, durationSeconds: null,
    externalMessageId: `ext-${id}`, status: null, isDeleted: false, quotedMessageId: null,
    sentAt: T, createdAt: T, fromParticipant, fromParticipantName: null,
  };
}

function reaction(over: Partial<ChatMessageReaction>): ChatMessageReaction {
  return {
    id: 'r-1', tenantId: TENANT, messageId: 'm-1', emoji: '👍', reactorKey: 'pn:5511922223333',
    reactorPhone: '5511922223333', reactorName: 'pushName do Pedro', fromMe: false,
    externalId: null, reactedAt: T, createdAt: T, updatedAt: T,
    ...over,
  };
}

function makeDeps(opts: { messages: unknown[]; reactions: ChatMessageReaction[] }) {
  const messageRepo = {
    findMany: vi.fn().mockResolvedValue(opts.messages),
    findAround: vi.fn().mockResolvedValue(opts.messages),
  } as unknown as IChatMessageRepository;
  const conversationRepo = {
    findById: vi.fn().mockResolvedValue({ id: CONV, tenantId: TENANT }),
  } as unknown as IChatConversationRepository;
  const contactRepo = {
    findByPhones: vi.fn().mockResolvedValue([
      { phone: '5511911112222', name: 'Ana', avatarUrl: 'https://cdn/ana.jpg' },
      { phone: '5511922223333', name: 'Pedro da Agenda', avatarUrl: 'https://cdn/pedro.jpg' },
    ]),
  } as unknown as IChatContactRepository;
  const reactionRepo = {
    findByMessageIds: vi.fn().mockResolvedValue(opts.reactions),
  } as unknown as IChatMessageReactionRepository;
  const useCase = new ListMessagesUseCase(messageRepo, conversationRepo, contactRepo, reactionRepo);
  return { messageRepo, contactRepo, reactionRepo, useCase };
}

describe('ListMessagesUseCase — reações', () => {
  it('busca reações e contatos uma única vez por página, com os autores no mesmo lote', async () => {
    const deps = makeDeps({
      messages: [message('m-1', '5511911112222'), message('m-2', null)],
      reactions: [reaction({})],
    });

    await deps.useCase.execute({ conversationId: CONV, tenantId: TENANT });

    expect(deps.reactionRepo.findByMessageIds).toHaveBeenCalledTimes(1);
    expect(deps.reactionRepo.findByMessageIds).toHaveBeenCalledWith(['m-1', 'm-2'], TENANT);
    expect(deps.contactRepo.findByPhones).toHaveBeenCalledTimes(1);
    expect(deps.contactRepo.findByPhones).toHaveBeenCalledWith(
      ['5511911112222', '5511922223333'], TENANT,
    );
  });

  it('também faz uma busca só ao saltar para uma mensagem', async () => {
    const deps = makeDeps({ messages: [message('m-1', null)], reactions: [] });

    await deps.useCase.execute({ conversationId: CONV, tenantId: TENANT, around: 'm-1' });

    expect(deps.reactionRepo.findByMessageIds).toHaveBeenCalledTimes(1);
    expect(deps.contactRepo.findByPhones).toHaveBeenCalledTimes(1);
  });

  it('mantém a foto do remetente e resolve o nome do autor da reação pelo contato', async () => {
    const deps = makeDeps({
      messages: [message('m-1', '5511911112222')],
      reactions: [reaction({})],
    });

    const [dto] = await deps.useCase.execute({ conversationId: CONV, tenantId: TENANT });

    expect(dto.fromParticipantAvatarUrl).toBe('https://cdn/ana.jpg');
    expect(dto.reactionsRevision).toBe(T.toISOString());
    expect(dto.reactions).toEqual([{
      emoji: '👍', count: 1, reactedByMe: false,
      reactors: [{ name: 'Pedro da Agenda', phone: '5511922223333' }],
    }]);
  });

  it('mensagem sem reação vem com lista vazia e revisão nula', async () => {
    const deps = makeDeps({
      messages: [message('m-1', null), message('m-2', null)],
      reactions: [reaction({ messageId: 'm-1' })],
    });

    const [, second] = await deps.useCase.execute({ conversationId: CONV, tenantId: TENANT });

    expect(second.reactions).toEqual([]);
    expect(second.reactionsRevision).toBeNull();
  });

  it('página vazia não consulta reações', async () => {
    const deps = makeDeps({ messages: [], reactions: [] });

    const out = await deps.useCase.execute({ conversationId: CONV, tenantId: TENANT });

    expect(out).toEqual([]);
    expect(deps.reactionRepo.findByMessageIds).not.toHaveBeenCalled();
  });
});
