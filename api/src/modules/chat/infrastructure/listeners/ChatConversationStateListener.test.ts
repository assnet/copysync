import { describe, it, expect } from 'vitest';
import { toWsShape } from './ChatConversationStateListener';

describe('toWsShape', () => {
  it('converte leitura remota em contador zerado e marcação limpa', () => {
    expect(toWsShape({ unreadCount: 0, manuallyUnread: false })).toEqual({
      unreadCount: 0,
      manuallyUnread: false,
    });
  });

  it('converte a data de silenciamento em ISO', () => {
    const ate = new Date('2026-09-21T15:00:00.000Z');
    expect(toWsShape({ mutedUntil: ate })).toEqual({ mutedUntil: ate.toISOString() });
  });

  it('mantém null quando o silenciamento é removido', () => {
    expect(toWsShape({ mutedUntil: null })).toEqual({ mutedUntil: null });
  });

  it('omite campo que não mudou, em vez de mandar false', () => {
    // Campo ausente significa "não houve mudança"; mandar false apagaria estado no painel.
    const shape = toWsShape({ pinned: true });
    expect(shape).toEqual({ pinned: true });
    expect(shape).not.toHaveProperty('archived');
    expect(shape).not.toHaveProperty('unreadCount');
  });

  it('nunca inventa marcações que só existem no painel', () => {
    // favorite e lists não têm equivalente no WhatsApp: este emissor não fala delas.
    const shape = toWsShape({ archived: true, pinned: false, unreadCount: 0 });
    expect(shape).not.toHaveProperty('favorite');
    expect(shape).not.toHaveProperty('lists');
  });

  it('repassa o total vindo do history sync', () => {
    expect(toWsShape({ unreadCount: 7 })).toEqual({ unreadCount: 7 });
  });

  it('devolve objeto vazio quando não houve mudança alguma', () => {
    expect(toWsShape({})).toEqual({});
  });
});
