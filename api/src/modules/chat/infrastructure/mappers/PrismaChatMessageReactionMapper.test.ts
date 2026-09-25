import type { ChatMessageReaction as PrismaChatMessageReaction } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { PrismaChatMessageReactionMapper } from './PrismaChatMessageReactionMapper';

function row(overrides: Partial<PrismaChatMessageReaction> = {}): PrismaChatMessageReaction {
  return {
    id: 'r-1',
    tenantId: 't-1',
    messageId: 'm-1',
    emoji: '👍',
    reactorKey: 'pn:5511999999999',
    reactorPhone: '5511999999999',
    reactorName: 'Maria',
    fromMe: false,
    externalId: 'EXT-1',
    reactedAt: new Date('2026-09-01T10:00:00.000Z'),
    createdAt: new Date('2026-09-01T10:00:01.000Z'),
    updatedAt: new Date('2026-09-01T10:00:02.000Z'),
    ...overrides,
  };
}

describe('PrismaChatMessageReactionMapper', () => {
  it('traduz a linha gravada para a reação do domínio sem perder campos', () => {
    const raw = row();

    expect(PrismaChatMessageReactionMapper.toDomain(raw)).toEqual({
      id: 'r-1',
      tenantId: 't-1',
      messageId: 'm-1',
      emoji: '👍',
      reactorKey: 'pn:5511999999999',
      reactorPhone: '5511999999999',
      reactorName: 'Maria',
      fromMe: false,
      externalId: 'EXT-1',
      reactedAt: raw.reactedAt,
      createdAt: raw.createdAt,
      updatedAt: raw.updatedAt,
    });
  });

  it('mantém nulos o telefone e o nome quando o autor esconde o número', () => {
    const reaction = PrismaChatMessageReactionMapper.toDomain(
      row({ reactorKey: 'lid:123', reactorPhone: null, reactorName: null, externalId: null }),
    );

    expect(reaction.reactorPhone).toBeNull();
    expect(reaction.reactorName).toBeNull();
    expect(reaction.externalId).toBeNull();
  });

  it('preserva o tombstone como emoji nulo, nunca string vazia', () => {
    expect(PrismaChatMessageReactionMapper.toDomain(row({ emoji: null })).emoji).toBeNull();
  });

  it('entrega os carimbos como Date para a comparação de last-write-wins', () => {
    const reaction = PrismaChatMessageReactionMapper.toDomain(row());

    expect(reaction.reactedAt).toBeInstanceOf(Date);
    expect(reaction.reactedAt.getTime()).toBe(Date.parse('2026-09-01T10:00:00.000Z'));
    expect(reaction.createdAt).toBeInstanceOf(Date);
    expect(reaction.updatedAt).toBeInstanceOf(Date);
  });

  it('preserva a autoria da nossa própria conta', () => {
    const reaction = PrismaChatMessageReactionMapper.toDomain(row({ reactorKey: 'self', fromMe: true }));

    expect(reaction.fromMe).toBe(true);
    expect(reaction.reactorKey).toBe('self');
  });
});
