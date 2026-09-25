import { describe, it, expect } from 'vitest';
import type { ChatMessage, MessageReaction } from './types';
import {
  acceptIntoMessages,
  applyPendingOverlay,
  displayedReactions,
  keepNewerReactions,
  reduceMessageReactions,
  selectReactionToSend,
  type MessageReactionState,
  type ReactionAction,
  type ReactionAggregate,
} from './reactionsState';

const me = { name: null, phone: null, isMe: true };
const ana = { name: 'Ana', phone: '5511999990000', isMe: false };
// Número privado sem telefone: mesmo nome/telefone nulos do operador, mas não é ele.
const anon = { name: null, phone: null, isMe: false };
const mine = (emoji: string, extra: MessageReaction['reactors'] = []): MessageReaction => ({
  emoji,
  count: 1 + extra.length,
  reactedByMe: true,
  reactors: [...extra, me],
});
const other = (emoji: string): MessageReaction => ({ emoji, count: 1, reactedByMe: false, reactors: [ana] });
const agg = (revision: string | null, reactions: MessageReaction[]): ReactionAggregate => ({ revision, reactions });

const T1 = '2026-09-24T10:00:00.000Z';
const T2 = '2026-09-24T10:00:01.000Z';
const T3 = '2026-09-24T10:00:02.000Z';

const run = (state: MessageReactionState, ...actions: ReactionAction[]) =>
  actions.reduce(reduceMessageReactions, state);
const emojisShown = (s: MessageReactionState) => displayedReactions(s).map((r) => `${r.emoji}${r.count}${r.reactedByMe ? '*' : ''}`);

describe('estado otimista das reações', () => {
  const empty: MessageReactionState = { server: agg(null, []), pending: [] };

  it('clique aparece na hora e a resposta do servidor assume', () => {
    const clicked = run(empty, { type: 'click', requestId: 'a', emoji: '👍' });
    expect(emojisShown(clicked)).toEqual(['👍1*']);

    const done = run(clicked, { type: 'sent', requestId: 'a', discardedIds: [] }, {
      type: 'success',
      requestId: 'a',
      aggregate: agg(T1, [mine('👍')]),
    });
    expect(done.pending).toEqual([]);
    expect(emojisShown(done)).toEqual(['👍1*']);
  });

  it('erro remove o clique e a bolha volta a mostrar o servidor', () => {
    const start: MessageReactionState = { server: agg(T1, [other('❤️')]), pending: [] };
    const s = run(
      start,
      { type: 'click', requestId: 'a', emoji: '👍' },
      { type: 'sent', requestId: 'a', discardedIds: [] },
      { type: 'error', requestId: 'a' },
    );
    expect(s.pending).toEqual([]);
    expect(emojisShown(s)).toEqual(['❤️1']);
  });

  it('WS com o gesto chega antes do erro (timeout): a reação continua visível', () => {
    const s = run(
      empty,
      { type: 'click', requestId: 'a', emoji: '👍' },
      { type: 'sent', requestId: 'a', discardedIds: [] },
      { type: 'server', aggregate: agg(T1, [mine('👍')]) },
      { type: 'error', requestId: 'a' },
    );
    expect(emojisShown(s)).toEqual(['👍1*']);
  });

  it('dois cliques com respostas HTTP fora de ordem: fica o último clique', () => {
    const s = run(
      empty,
      { type: 'click', requestId: 'a', emoji: '👍' },
      { type: 'sent', requestId: 'a', discardedIds: [] },
      { type: 'click', requestId: 'b', emoji: '❤️' },
      { type: 'sent', requestId: 'b', discardedIds: [] },
      { type: 'success', requestId: 'b', aggregate: agg(T2, [mine('❤️')]) },
      { type: 'success', requestId: 'a', aggregate: agg(T1, [mine('👍')]) },
    );
    expect(s.pending).toEqual([]);
    expect(s.server?.revision).toBe(T2);
    expect(emojisShown(s)).toEqual(['❤️1*']);
  });

  it('agregado com revision menor é descartado; igual é aceito', () => {
    const start: MessageReactionState = { server: agg(T2, [other('❤️')]), pending: [] };
    expect(run(start, { type: 'server', aggregate: agg(T1, []) }).server?.revision).toBe(T2);
    expect(run(start, { type: 'server', aggregate: agg(null, []) }).server?.revision).toBe(T2);
    expect(emojisShown(run(start, { type: 'server', aggregate: agg(T2, [other('😂')]) }))).toEqual(['😂1']);
  });

  it('com o último pendente por cima, cliques anteriores não aparecem', () => {
    const s = run(
      { server: agg(T1, [mine('👍', [ana])]), pending: [] },
      { type: 'click', requestId: 'a', emoji: '❤️' },
      { type: 'click', requestId: 'b', emoji: null },
    );
    expect(emojisShown(s)).toEqual(['👍1']);
  });

  it('descarte de drafts pelo despachante só tira aqueles cliques', () => {
    const s = run(
      empty,
      { type: 'click', requestId: 'a', emoji: '👍' },
      { type: 'click', requestId: 'b', emoji: '❤️' },
      { type: 'sent', requestId: 'b', discardedIds: ['a'] },
    );
    expect(s.pending).toEqual([{ requestId: 'b', emoji: '❤️', status: 'inflight' }]);
  });
});

describe('sobreposição do gesto', () => {
  it('troca: tira do emoji anterior, some no zero e soma no novo', () => {
    const out = applyPendingOverlay([mine('👍'), other('❤️')], '❤️');
    expect(out).toEqual([
      { emoji: '❤️', count: 2, reactedByMe: true, reactors: [ana, me] },
    ]);
  });

  it('remoção com outros no mesmo emoji: contagem −1 e sem o próprio autor', () => {
    expect(applyPendingOverlay([mine('👍', [ana])], null)).toEqual([
      { emoji: '👍', count: 1, reactedByMe: false, reactors: [ana] },
    ]);
  });

  it('remoção tira o operador, nunca o participante anônimo de mesmo formato', () => {
    // Anônimo vem antes na lista: identificar por nome/telefone nulos tiraria ele.
    expect(applyPendingOverlay([mine('👍', [anon])], null)).toEqual([
      { emoji: '👍', count: 1, reactedByMe: false, reactors: [anon] },
    ]);
  });

  it('emoji novo entra como grupo próprio', () => {
    expect(applyPendingOverlay([other('❤️')], '😂')).toEqual([
      other('❤️'),
      { emoji: '😂', count: 1, reactedByMe: true, reactors: [me] },
    ]);
  });
});

describe('selectReactionToSend', () => {
  const d = (...emojis: (string | null)[]) => emojis.map((emoji) => ({ emoji }));

  it('três cliques viram um envio com o último', () => {
    expect(selectReactionToSend(agg(null, []), [], d('❤️', '😂', '👍'))).toBe('👍');
  });

  it('vai e volta sem nada em voo não envia', () => {
    expect(selectReactionToSend(agg(T1, [mine('👍')]), [], d(null, '👍'))).toBe('skip');
  });

  it('servidor 👍 + remoção em voo + novo 👍 envia 👍', () => {
    expect(selectReactionToSend(agg(T1, [mine('👍')]), d(null), d('👍'))).toBe('👍');
  });

  it('draft igual ao alvo em voo não envia', () => {
    expect(selectReactionToSend(agg(null, []), d('❤️'), d('❤️'))).toBe('skip');
  });

  it('remoção quando há reação no servidor envia null', () => {
    expect(selectReactionToSend(agg(T1, [mine('👍')]), [], d(null))).toBeNull();
  });
});

describe('agregados nas mensagens da página', () => {
  const msg = (id: string, revision: string | null, reactions: MessageReaction[]): ChatMessage => ({
    id,
    conversationId: 'c1',
    type: 'text',
    direction: 'in',
    body: 'oi',
    timestamp: T1,
    status: 'read',
    reactions,
    reactionsRevision: revision,
  });

  it('WS atualiza só a mensagem alvo e ignora conversa não carregada', () => {
    const untouched = msg('m2', null, []);
    const state = { c1: [msg('m1', T1, []), untouched] };
    const next = acceptIntoMessages(state, 'c1', 'm1', agg(T2, [other('❤️')]));
    expect(next.c1[0].reactions).toEqual([other('❤️')]);
    expect(next.c1[1]).toBe(untouched);
    expect(acceptIntoMessages(state, 'c9', 'm1', agg(T2, []))).toBe(state);
    expect(acceptIntoMessages(state, 'c1', 'm1', agg(null, []))).toBe(state);
  });

  it('página do GET mais velha que o WS não desfaz o WS', () => {
    const afterWs = [msg('m1', T3, [other('❤️')])];
    const olderPage = [msg('m1', T1, []), msg('m0', null, [])];
    const merged = keepNewerReactions(afterWs, olderPage);
    expect(merged[0].reactionsRevision).toBe(T3);
    expect(merged[0].reactions).toEqual([other('❤️')]);
    expect(merged[1]).toBe(olderPage[1]);
  });

  it('página do GET mais nova substitui', () => {
    const merged = keepNewerReactions([msg('m1', T1, [])], [msg('m1', T2, [other('😂')])]);
    expect(merged[0].reactions).toEqual([other('😂')]);
  });
});
