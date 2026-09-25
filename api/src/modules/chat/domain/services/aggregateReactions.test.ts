import { describe, it, expect } from 'vitest';
import type { ChatMessageReaction } from '../entities/ChatMessageReaction';
import { aggregateReactions } from './aggregateReactions';

const BASE = Date.parse('2026-09-24T10:00:00.000Z');
const at = (s: number) => new Date(BASE + s * 1000);

let seq = 0;
function linha(overrides: Partial<ChatMessageReaction> = {}): ChatMessageReaction {
  seq += 1;
  return {
    id: `r${seq}`,
    tenantId: 't1',
    messageId: 'm1',
    emoji: '👍',
    reactorKey: `pn:55110000${seq}`,
    reactorPhone: `55110000${seq}`,
    reactorName: null,
    fromMe: false,
    externalId: null,
    reactedAt: at(0),
    createdAt: at(0),
    updatedAt: at(0),
    ...overrides,
  };
}

const semContatos = new Map<string, { name?: string | null }>();

describe('aggregateReactions', () => {
  it('devolve agregado vazio sem linhas', () => {
    expect(aggregateReactions([], semContatos)).toEqual({ revision: null, reactions: [] });
  });

  it('agrupa por emoji e conta os autores', () => {
    const { reactions } = aggregateReactions(
      [linha({ emoji: '👍' }), linha({ emoji: '👍' }), linha({ emoji: '❤️' })],
      semContatos,
    );
    expect(reactions.map((r) => [r.emoji, r.count])).toEqual([
      ['👍', 2],
      ['❤️', 1],
    ]);
  });

  it('não lista tombstones', () => {
    const { reactions } = aggregateReactions(
      [linha({ emoji: '👍' }), linha({ emoji: null })],
      semContatos,
    );
    expect(reactions).toHaveLength(1);
    expect(reactions[0].count).toBe(1);
  });

  it('ordena por contagem e, no empate, pela primeira reação', () => {
    const { reactions } = aggregateReactions(
      [
        linha({ emoji: '😂', reactedAt: at(5) }),
        linha({ emoji: '🙏', reactedAt: at(1) }),
        linha({ emoji: '❤️', reactedAt: at(9) }),
        linha({ emoji: '❤️', reactedAt: at(10) }),
      ],
      semContatos,
    );
    expect(reactions.map((r) => r.emoji)).toEqual(['❤️', '🙏', '😂']);
  });

  it('marca reactedByMe quando a nossa conta reagiu com aquele emoji', () => {
    const { reactions } = aggregateReactions(
      [
        linha({ emoji: '👍', reactorKey: 'self', reactorPhone: null, fromMe: true }),
        linha({ emoji: '👍' }),
        linha({ emoji: '❤️' }),
      ],
      semContatos,
    );
    expect(reactions.find((r) => r.emoji === '👍')?.reactedByMe).toBe(true);
    expect(reactions.find((r) => r.emoji === '❤️')?.reactedByMe).toBe(false);
  });

  it('resolve o nome pelo contato, depois pelo nome gravado, senão null', () => {
    const contatos = new Map([['5511999', { name: 'Maria (contato)' }]]);
    const { reactions } = aggregateReactions(
      [
        linha({ reactorPhone: '5511999', reactorName: 'Mari', reactedAt: at(1) }),
        linha({ reactorPhone: '5511888', reactorName: 'João', reactedAt: at(2) }),
        linha({ reactorKey: 'lid:abc', reactorPhone: null, reactorName: null, reactedAt: at(3) }),
      ],
      contatos,
    );
    expect(reactions[0].reactors).toEqual([
      { name: 'Maria (contato)', phone: '5511999' },
      { name: 'João', phone: '5511888' },
      { name: null, phone: null },
    ]);
  });

  it('limita os autores a 10 sem alterar a contagem', () => {
    const rows = Array.from({ length: 12 }, (_, i) => linha({ reactedAt: at(i) }));
    const { reactions } = aggregateReactions(rows, semContatos);
    expect(reactions[0].count).toBe(12);
    expect(reactions[0].reactors).toHaveLength(10);
  });

  it('usa o maior updatedAt como revisão', () => {
    const { revision } = aggregateReactions(
      [linha({ updatedAt: at(3) }), linha({ updatedAt: at(7) }), linha({ updatedAt: at(1) })],
      semContatos,
    );
    expect(revision).toBe(at(7).toISOString());
  });

  it('avança a revisão quando a remoção é a escrita mais recente', () => {
    // Sem isso o painel descartaria o agregado da remoção como velho e o chip ficaria na tela.
    const { revision, reactions } = aggregateReactions(
      [linha({ updatedAt: at(3) }), linha({ emoji: null, updatedAt: at(8) })],
      semContatos,
    );
    expect(revision).toBe(at(8).toISOString());
    expect(reactions).toHaveLength(1);
  });

  it('tem revisão mesmo quando só restam tombstones', () => {
    expect(aggregateReactions([linha({ emoji: null, updatedAt: at(4) })], semContatos)).toEqual({
      revision: at(4).toISOString(),
      reactions: [],
    });
  });
});
