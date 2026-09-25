import { describe, it, expect } from 'vitest';
import type { ChatMessage } from './types';
import { mergeLatestMessages, upsertConfirmedMessage } from './messagesMerge';

const msg = (id: string, segundo: number, status: ChatMessage['status'] = 'read'): ChatMessage => ({
  id,
  conversationId: 'c1',
  type: 'text',
  direction: 'in',
  body: id,
  timestamp: new Date(Date.UTC(2026, 8, 25, 10, 0, segundo)).toISOString(),
  status,
});

const ids = (list: ChatMessage[]) => list.map((m) => m.id);

describe('mergeLatestMessages — GET de abertura ou resync sobre a lista local', () => {
  it('sem lista local, vale o que veio do servidor', () => {
    const servidor = [msg('a', 1), msg('b', 2)];
    expect(mergeLatestMessages(undefined, servidor)).toBe(servidor);
    expect(mergeLatestMessages([], servidor)).toBe(servidor);
  });

  it('mantém a mensagem local mais nova que o GET (mídia confirmada com o GET em voo)', () => {
    const local = [msg('a', 1), msg('midia', 9, 'sending')];
    const servidor = [msg('a', 1), msg('b', 2)];
    expect(ids(mergeLatestMessages(local, servidor))).toEqual(['a', 'b', 'midia']);
  });

  it('descarta a local mais antiga que o fim do GET e ausente dele: a janela do servidor manda', () => {
    const local = [msg('velha', 1), msg('a', 3)];
    const servidor = [msg('a', 3), msg('b', 4)];
    expect(ids(mergeLatestMessages(local, servidor))).toEqual(['a', 'b']);
  });

  it('mantém texto ainda em envio (tmp) mesmo com relógio do servidor adiantado', () => {
    const local = [msg('tmp-123', 1, 'sending')];
    const servidor = [msg('a', 5)];
    expect(ids(mergeLatestMessages(local, servidor))).toEqual(['a', 'tmp-123']);
  });

  it('não duplica mensagem que já veio no GET', () => {
    const local = [msg('a', 1), msg('b', 9)];
    const servidor = [msg('a', 1), msg('b', 9)];
    expect(ids(mergeLatestMessages(local, servidor))).toEqual(['a', 'b']);
  });

  it('status mais novo da lista (WS) vence o `sending` que o GET trouxe', () => {
    const local = [msg('m', 5, 'delivered')];
    const servidor = [msg('m', 5, 'sending')];
    expect(mergeLatestMessages(local, servidor)[0].status).toBe('delivered');
  });

  it('status do GET vence quando não é `sending` (mídia PENDING que o WS perdeu)', () => {
    const local = [msg('m', 5, 'sending')];
    const servidor = [msg('m', 5, 'sent')];
    expect(mergeLatestMessages(local, servidor)[0].status).toBe('sent');
  });

  it('GET vazio mantém a lista local', () => {
    const local = [msg('tmp-1', 1, 'sending'), msg('m', 2)];
    expect(ids(mergeLatestMessages(local, []))).toEqual(['tmp-1', 'm']);
  });
});

describe('upsertConfirmedMessage — mensagem real do 202/200', () => {
  it('anexa ao fim quando ainda não está na lista', () => {
    const lista = [msg('a', 1)];
    expect(ids(upsertConfirmedMessage(lista, msg('m', 2, 'sending')))).toEqual(['a', 'm']);
  });

  it('troca no lugar quando o GET já a trouxe', () => {
    const lista = [msg('m', 2, 'sending'), msg('b', 3)];
    const confirmada = { ...msg('m', 2, 'sending'), body: 'legenda' };
    const r = upsertConfirmedMessage(lista, confirmada);
    expect(ids(r)).toEqual(['m', 'b']);
    expect(r[0].body).toBe('legenda');
  });

  it('não regride status: a lista pode ter recebido SENT pelo WS antes do 202', () => {
    const lista = [msg('m', 2, 'sent')];
    expect(upsertConfirmedMessage(lista, msg('m', 2, 'sending'))[0].status).toBe('sent');
  });
});
