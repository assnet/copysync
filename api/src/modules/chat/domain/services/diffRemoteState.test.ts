import { describe, it, expect } from 'vitest';
import { diffRemoteState, type CurrentConversationState } from './diffRemoteState';

function atual(overrides: Partial<CurrentConversationState> = {}): CurrentConversationState {
  return {
    unreadCount: 0,
    manuallyUnread: false,
    archived: false,
    pinned: false,
    mutedUntil: null,
    ...overrides,
  };
}

describe('diffRemoteState', () => {
  it('zera contador e marcação quando a conversa foi lida em outro aparelho', () => {
    expect(diffRemoteState(atual({ unreadCount: 12 }), { read: true })).toEqual({
      unreadCount: 0,
      manuallyUnread: false,
    });
  });

  it('limpa a marcação manual mesmo sem mensagens pendentes', () => {
    expect(diffRemoteState(atual({ manuallyUnread: true }), { read: true })).toEqual({
      unreadCount: 0,
      manuallyUnread: false,
    });
  });

  it('não grava nada quando a conversa já estava lida', () => {
    // Eco da própria ação do painel: sem este corte, cada arquivamento viraria uma
    // gravação e um frame de WebSocket inúteis.
    expect(diffRemoteState(atual(), { read: true })).toEqual({});
  });

  it('marca como não lida quando o usuário fez isso em outro aparelho', () => {
    expect(diffRemoteState(atual(), { manuallyUnread: true })).toEqual({ manuallyUnread: true });
  });

  it('reduz o contador quando o aparelho reporta menos não lidas', () => {
    // Caso real: painel acumulou 50 pela ingestão, o aparelho diz 3.
    expect(diffRemoteState(atual({ unreadCount: 50 }), { unreadCount: 3 })).toEqual({ unreadCount: 3 });
  });

  it('não aumenta o contador a partir de um total antigo', () => {
    // History sync chega em lotes sem ordem garantida: um retrato atrasado faria o
    // badge ressuscitar numa conversa recém-lida. Subir é tarefa da ingestão.
    expect(diffRemoteState(atual({ unreadCount: 0 }), { unreadCount: 3 })).toEqual({});
  });

  it('não ressuscita badge na conversa aberta', () => {
    // Conversa aberta tem contador zerado localmente; o mesmo corte protege esse caso.
    expect(diffRemoteState(atual({ unreadCount: 0 }), { unreadCount: 7 })).toEqual({});
  });

  it('ignora total igual ao persistido', () => {
    expect(diffRemoteState(atual({ unreadCount: 4 }), { unreadCount: 4 })).toEqual({});
  });

  it('espelha arquivamento nos dois sentidos', () => {
    expect(diffRemoteState(atual(), { archived: true })).toEqual({ archived: true });
    expect(diffRemoteState(atual({ archived: true }), { archived: false })).toEqual({ archived: false });
  });

  it('espelha fixação e silenciamento', () => {
    const ate = new Date('2026-09-24T18:00:00.000Z');
    expect(diffRemoteState(atual(), { pinned: true, mutedUntil: ate })).toEqual({
      pinned: true,
      mutedUntil: ate,
    });
  });

  it('reconhece remoção do silenciamento', () => {
    const antes = atual({ mutedUntil: new Date('2026-09-24T18:00:00.000Z') });
    expect(diffRemoteState(antes, { mutedUntil: null })).toEqual({ mutedUntil: null });
  });

  it('ignora silenciamento com o mesmo instante', () => {
    const ate = new Date('2026-09-24T18:00:00.000Z');
    expect(diffRemoteState(atual({ mutedUntil: new Date(ate) }), { mutedUntil: ate })).toEqual({});
  });

  it('não interpreta campo ausente como false', () => {
    // Evento que só fala de fixação não pode desarquivar a conversa.
    const antes = atual({ archived: true, pinned: false });
    expect(diffRemoteState(antes, { pinned: true })).toEqual({ pinned: true });
  });

  it('combina estados distintos no mesmo evento', () => {
    const antes = atual({ unreadCount: 5, archived: false });
    expect(diffRemoteState(antes, { read: true, archived: true })).toEqual({
      unreadCount: 0,
      manuallyUnread: false,
      archived: true,
    });
  });
});
