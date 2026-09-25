import { describe, it, expect, vi } from 'vitest';
import { normalizeReactionEvent, type RawReactionItem } from './normalizeReactionEvent';

const NOW = new Date('2026-09-24T12:00:00.000Z').getTime();
const SENT = new Date('2026-09-24T11:59:00.000Z').getTime();

const noEcho = () => false;

function item(overrides: Partial<NonNullable<RawReactionItem['reaction']>> = {}, key: RawReactionItem['key'] = {}): RawReactionItem {
  return {
    key: { id: 'ALVO', remoteJid: '5511999990000@s.whatsapp.net', fromMe: true, ...key },
    reaction: {
      text: '👍',
      senderTimestampMs: SENT,
      ...overrides,
      key: {
        id: 'REACAO',
        remoteJid: '5511999990000@s.whatsapp.net',
        fromMe: false,
        ...overrides.key,
      },
    },
  };
}

describe('normalizeReactionEvent', () => {
  it('lê o alvo de item.key e o autor de item.reaction.key', () => {
    // A lib monta o item com a key da mensagem ALVO no topo e a key da mensagem de
    // reação dentro de `reaction` — trocar os dois grava a reação na mensagem errada.
    const result = normalizeReactionEvent(
      {
        key: { id: 'ALVO', remoteJid: '5511999990000@s.whatsapp.net', fromMe: true },
        reaction: {
          text: '❤️',
          senderTimestampMs: SENT,
          key: { id: 'REACAO', remoteJid: '5511999990000@s.whatsapp.net', fromMe: false },
        },
      },
      { now: NOW, consumeEcho: noEcho },
    );

    expect(result).toEqual({
      targetExternalMessageId: 'ALVO',
      reactionExternalId: 'REACAO',
      emoji: '❤️',
      reactorKey: 'pn:5511999990000',
      reactorPhone: '5511999990000',
      unresolvedLid: null,
      fromMe: false,
      isEcho: false,
      reactedAt: new Date(SENT).toISOString(),
    });
  });

  it('trata texto vazio como remoção da reação', () => {
    expect(normalizeReactionEvent(item({ text: '' }), { now: NOW, consumeEcho: noEcho })?.emoji).toBeNull();
    expect(normalizeReactionEvent(item({ text: null }), { now: NOW, consumeEcho: noEcho })?.emoji).toBeNull();
  });

  it('em grupo, o autor é o participant da key de reação', () => {
    const result = normalizeReactionEvent(
      item(
        { key: { remoteJid: '1203630@g.us', participant: '5521988887777@s.whatsapp.net' } },
        { remoteJid: '1203630@g.us' },
      ),
      { now: NOW, consumeEcho: noEcho },
    );
    expect(result?.reactorKey).toBe('pn:5521988887777');
    expect(result?.reactorPhone).toBe('5521988887777');
  });

  it('autor @lid sem alternativa mantém a reação com telefone nulo', () => {
    const result = normalizeReactionEvent(
      item(
        { key: { remoteJid: '1203630@g.us', participant: '99887766@lid' } },
        { remoteJid: '1203630@g.us' },
      ),
      { now: NOW, consumeEcho: noEcho },
    );
    expect(result).not.toBeNull();
    expect(result?.reactorKey).toBe('lid:99887766');
    expect(result?.reactorPhone).toBeNull();
    // O handler ainda tenta o mapeamento de LID da sessão.
    expect(result?.unresolvedLid).toBe('99887766@lid');
  });

  it('autor @lid com participantAlt usa o telefone só para exibição, nunca na chave', () => {
    const result = normalizeReactionEvent(
      item(
        {
          key: {
            remoteJid: '1203630@g.us',
            participant: '99887766@lid',
            participantAlt: '5521988887777@s.whatsapp.net',
          },
        },
        { remoteJid: '1203630@g.us' },
      ),
      { now: NOW, consumeEcho: noEcho },
    );
    expect(result?.reactorKey).toBe('lid:99887766');
    expect(result?.reactorPhone).toBe('5521988887777');
    expect(result?.unresolvedLid).toBeNull();
  });

  it('conversa individual com autor @lid usa remoteJidAlt', () => {
    const result = normalizeReactionEvent(
      item({ key: { remoteJid: '99887766@lid', remoteJidAlt: '5511999990000@s.whatsapp.net' } }),
      { now: NOW, consumeEcho: noEcho },
    );
    expect(result?.reactorKey).toBe('lid:99887766');
    expect(result?.reactorPhone).toBe('5511999990000');
  });

  it('usa o horário atual quando senderTimestampMs falta, é zero ou inválido', () => {
    const expected = new Date(NOW).toISOString();
    for (const senderTimestampMs of [undefined, null, 0, Number.NaN]) {
      expect(normalizeReactionEvent(item({ senderTimestampMs }), { now: NOW, consumeEcho: noEcho })?.reactedAt)
        .toBe(expected);
    }
  });

  it('converte senderTimestampMs no formato Long do protobuf', () => {
    const long = { toNumber: () => SENT };
    expect(normalizeReactionEvent(item({ senderTimestampMs: long }), { now: NOW, consumeEcho: noEcho })?.reactedAt)
      .toBe(new Date(SENT).toISOString());
  });

  it('marca como eco a reação nossa cujo id está registrado', () => {
    const consumeEcho = vi.fn((id: string) => id === 'REACAO');
    const result = normalizeReactionEvent(item({ key: { fromMe: true } }), { now: NOW, consumeEcho });
    expect(result?.fromMe).toBe(true);
    expect(result?.reactorKey).toBe('self');
    expect(result?.reactorPhone).toBeNull();
    expect(result?.isEcho).toBe(true);
    expect(consumeEcho).toHaveBeenCalledWith('REACAO');
  });

  it('reação nossa sem id registrado não é eco (feita pelo celular)', () => {
    const result = normalizeReactionEvent(item({ key: { fromMe: true } }), { now: NOW, consumeEcho: noEcho });
    expect(result?.fromMe).toBe(true);
    expect(result?.isEcho).toBe(false);
  });

  it('não consulta o registro de ecos para reação de terceiro', () => {
    const consumeEcho = vi.fn(() => true);
    const result = normalizeReactionEvent(item(), { now: NOW, consumeEcho });
    expect(result?.isEcho).toBe(false);
    expect(consumeEcho).not.toHaveBeenCalled();
  });

  it('ignora status e listas de transmissão', () => {
    expect(normalizeReactionEvent(
      item({ key: { remoteJid: 'status@broadcast' } }, { remoteJid: 'status@broadcast' }),
      { now: NOW, consumeEcho: noEcho },
    )).toBeNull();
    expect(normalizeReactionEvent(
      item({ key: { remoteJid: '123@broadcast' } }, { remoteJid: '123@broadcast' }),
      { now: NOW, consumeEcho: noEcho },
    )).toBeNull();
  });

  it('descarta evento sem id do alvo', () => {
    expect(normalizeReactionEvent(item({}, { id: null }), { now: NOW, consumeEcho: noEcho })).toBeNull();
  });

  it('descarta reação de terceiro em grupo sem participant', () => {
    expect(normalizeReactionEvent(
      item({ key: { remoteJid: '1203630@g.us' } }, { remoteJid: '1203630@g.us' }),
      { now: NOW, consumeEcho: noEcho },
    )).toBeNull();
  });
});
