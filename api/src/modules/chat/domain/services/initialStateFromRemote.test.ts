import { describe, it, expect } from 'vitest';
import { initialStateFromRemote } from './initialStateFromRemote';

describe('initialStateFromRemote', () => {
  it('semeia o total de não lidas do aparelho', () => {
    expect(initialStateFromRemote({ unreadCount: 7 })).toEqual({ unreadCount: 7 });
  });

  it('nasce lida quando o aparelho reporta leitura', () => {
    expect(initialStateFromRemote({ read: true })).toEqual({ unreadCount: 0 });
  });

  it('semeia arquivamento, fixação e silenciamento', () => {
    const ate = new Date('2026-09-25T10:00:00.000Z');
    expect(initialStateFromRemote({ archived: true, pinned: true, mutedUntil: ate })).toEqual({
      archived: true,
      pinned: true,
      mutedUntil: ate,
    });
  });

  it('semeia a marcação manual de não lida', () => {
    expect(initialStateFromRemote({ manuallyUnread: true })).toEqual({ manuallyUnread: true });
  });

  it('omite o que o aparelho não informou, em vez de zerar', () => {
    // Campo ausente vira ausente: quem decide o padrão é o schema do banco, não esta
    // tradução. Mandar false aqui seria inventar estado.
    const inicial = initialStateFromRemote({ archived: false });
    expect(inicial).toEqual({ archived: false });
    expect(inicial).not.toHaveProperty('pinned');
    expect(inicial).not.toHaveProperty('unreadCount');
  });

  it('devolve objeto vazio quando não há retrato algum', () => {
    expect(initialStateFromRemote({})).toEqual({});
  });

  it('combina o retrato inteiro do aparelho', () => {
    expect(initialStateFromRemote({ unreadCount: 4, archived: true, pinned: false })).toEqual({
      unreadCount: 4,
      archived: true,
      pinned: false,
    });
  });
});
