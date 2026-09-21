import { describe, expect, it } from 'vitest';
import { formatLastMessagePreview, formatPhone, byPinnedThenRecent, isUnread, countUnread } from './utils';

describe('formatPhone', () => {
  it('formata celular brasileiro de 13 dígitos com o nono dígito separado', () => {
    expect(formatPhone('5511988881234')).toBe('+55 11 9 8888-1234');
  });

  it('formata fixo/legado de 12 dígitos', () => {
    expect(formatPhone('554499881234')).toBe('+55 44 9988-1234');
  });

  it('devolve a entrada intacta quando o tamanho não é reconhecido', () => {
    expect(formatPhone('12345')).toBe('12345');
  });
});

describe('formatLastMessagePreview', () => {
  it('usa a legenda quando a mídia tem legenda', () => {
    expect(formatLastMessagePreview('IMAGE', 'orçamento')).toBe('📷 orçamento');
  });

  it('usa o rótulo do tipo quando a mídia não tem legenda', () => {
    expect(formatLastMessagePreview('IMAGE', null)).toBe('📷 Foto');
  });

  it('ignora a legenda em tipos sem preview textual', () => {
    expect(formatLastMessagePreview('AUDIO', 'qualquer coisa')).toBe('🎵 Áudio');
  });

  it('trata tipo ausente como texto', () => {
    expect(formatLastMessagePreview(null, 'oi')).toBe('oi');
    expect(formatLastMessagePreview(undefined, undefined)).toBe('');
  });
});

describe('byPinnedThenRecent', () => {
  const conv = (pinned: boolean, lastMessageAt: string | null) => ({ pinned, lastMessageAt });

  it('coloca conversa fixada antes da não fixada', () => {
    const lista = [conv(false, '2026-09-21T12:00:00Z'), conv(true, '2020-01-01T00:00:00Z')];
    expect([...lista].sort(byPinnedThenRecent)).toEqual([lista[1], lista[0]]);
  });

  it('entre duas fixadas, a mais recente vem primeiro', () => {
    const antiga = conv(true, '2026-09-20T10:00:00Z');
    const nova   = conv(true, '2026-09-21T10:00:00Z');
    expect([antiga, nova].sort(byPinnedThenRecent)).toEqual([nova, antiga]);
  });

  it('mensagem nova em conversa comum não ultrapassa a fixada', () => {
    const fixada = conv(true, '2026-09-01T10:00:00Z');
    const recente = conv(false, '2026-09-21T23:59:00Z');
    expect([recente, fixada].sort(byPinnedThenRecent)).toEqual([fixada, recente]);
  });

  it('conversa sem data não quebra a ordenação', () => {
    const semData = conv(false, null);
    const comData = conv(false, '2026-09-21T10:00:00Z');
    expect([semData, comData].sort(byPinnedThenRecent)).toEqual([comData, semData]);
  });

  it('trata pinned ausente como não fixada', () => {
    const indefinida = { lastMessageAt: '2026-09-21T10:00:00Z' };
    const fixada = conv(true, '2026-09-01T10:00:00Z');
    expect([indefinida, fixada].sort(byPinnedThenRecent)).toEqual([fixada, indefinida]);
  });
});

describe('isUnread', () => {
  it('reconhece conversa com mensagens pendentes', () => {
    expect(isUnread({ unreadCount: 3 })).toBe(true);
  });

  it('reconhece conversa marcada como não lida mesmo sem mensagens pendentes', () => {
    expect(isUnread({ unreadCount: 0, manuallyUnread: true })).toBe(true);
  });

  it('não destaca conversa lida', () => {
    expect(isUnread({ unreadCount: 0, manuallyUnread: false })).toBe(false);
    expect(isUnread({ unreadCount: 0 })).toBe(false);
  });
});

describe('countUnread', () => {
  it('soma as mensagens pendentes', () => {
    expect(countUnread([{ unreadCount: 2 }, { unreadCount: 3 }])).toBe(5);
  });

  it('conta conversa marcada manualmente como uma', () => {
    // Total zerado com conversa destacada na lista seria contradição visível.
    expect(countUnread([{ unreadCount: 0, manuallyUnread: true }])).toBe(1);
  });

  it('não soma duas vezes quando há pendentes e marcação manual', () => {
    expect(countUnread([{ unreadCount: 4, manuallyUnread: true }])).toBe(4);
  });

  it('ignora conversas lidas', () => {
    expect(countUnread([{ unreadCount: 0 }, { unreadCount: 0, manuallyUnread: false }])).toBe(0);
  });
});
