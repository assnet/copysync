import { describe, it, expect } from 'vitest';
import { normalizeChatState, isEmptyChatState } from './normalizeChatState';

const NOW = new Date('2026-09-21T12:00:00.000Z').getTime();

describe('normalizeChatState', () => {
  it('trata contador zerado como conversa lida em outro aparelho', () => {
    expect(normalizeChatState({ unreadCount: 0 }, NOW)).toEqual({ read: true });
  });

  it('trata contador negativo como marcação manual de não lida', () => {
    expect(normalizeChatState({ unreadCount: -1 }, NOW)).toEqual({ manuallyUnread: true });
  });

  it('ignora contador positivo, que é incremento e não total', () => {
    // O painel mantém o próprio contador pela ingestão de mensagens; copiar o valor
    // do WhatsApp aqui duplicaria a contagem.
    expect(normalizeChatState({ unreadCount: 3 }, NOW)).toEqual({});
  });

  it('ignora contador ausente ou nulo', () => {
    expect(normalizeChatState({}, NOW)).toEqual({});
    expect(normalizeChatState({ unreadCount: null }, NOW)).toEqual({});
  });

  it('espelha o arquivamento nos dois sentidos', () => {
    expect(normalizeChatState({ archived: true }, NOW)).toEqual({ archived: true });
    expect(normalizeChatState({ archived: false }, NOW)).toEqual({ archived: false });
  });

  it('converte o timestamp de fixação em booleano', () => {
    expect(normalizeChatState({ pinned: 1_700_000_000 }, NOW)).toEqual({ pinned: true });
    expect(normalizeChatState({ pinned: null }, NOW)).toEqual({ pinned: false });
  });

  it('converte o fim do silenciamento em data', () => {
    const fim = NOW + 3_600_000;
    expect(normalizeChatState({ muteEndTime: fim }, NOW)).toEqual({ mutedUntil: new Date(fim) });
  });

  it('trata silenciamento já expirado como conversa com notificações', () => {
    expect(normalizeChatState({ muteEndTime: NOW - 1 }, NOW)).toEqual({ mutedUntil: null });
    expect(normalizeChatState({ muteEndTime: null }, NOW)).toEqual({ mutedUntil: null });
  });

  it('combina vários estados no mesmo evento', () => {
    expect(normalizeChatState({ unreadCount: 0, archived: true, pinned: null }, NOW)).toEqual({
      read: true,
      archived: true,
      pinned: false,
    });
  });

  it('não interpreta ausência de campo como false', () => {
    // Um evento que só fala de fixação não pode apagar o arquivamento persistido.
    const state = normalizeChatState({ pinned: 1_700_000_000 }, NOW);
    expect(state).not.toHaveProperty('archived');
    expect(state).not.toHaveProperty('mutedUntil');
  });
});

describe('isEmptyChatState', () => {
  it('reconhece estado sem nada a espelhar', () => {
    expect(isEmptyChatState({})).toBe(true);
    expect(isEmptyChatState({ read: true })).toBe(false);
    expect(isEmptyChatState({ archived: false })).toBe(false);
  });
});
