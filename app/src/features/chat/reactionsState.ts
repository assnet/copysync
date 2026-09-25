import type { ChatMessage, MessageReaction } from './types';

/**
 * Estado otimista das reações (design §8, REACT-04) — só funções puras.
 *
 * Por mensagem há duas coisas separadas, o que dispensa snapshot:
 * - `server`: último agregado aceito do servidor (`PUT`, WS ou página do `GET`)
 * - `pending`: gestos do operador ainda sem resposta, em ordem de clique
 *
 * O que a bolha mostra é derivado: `server` com o ÚLTIMO pendente por cima.
 * No painel, `server` mora na própria `ChatMessage` (`reactions` + `reactionsRevision`)
 * e `pending` num mapa à parte na página — as funções abaixo servem aos dois.
 */

export interface ReactionAggregate {
  /** ISO do servidor; `null` = mensagem sem nenhuma linha de reação. */
  revision: string | null;
  reactions: MessageReaction[];
}

export interface PendingReaction {
  requestId: string;
  /** `null` = remover a própria reação. */
  emoji: string | null;
  status: 'draft' | 'inflight';
}

export interface MessageReactionState {
  server: ReactionAggregate | null;
  pending: PendingReaction[];
}

export type PendingAction =
  | { type: 'click'; requestId: string; emoji: string | null }
  /** Despachante enviou `requestId`; os `discardedIds` saíram sem requisição. */
  | { type: 'sent'; requestId: string; discardedIds: string[] }
  | { type: 'discarded'; requestIds: string[] }
  | { type: 'success'; requestId: string }
  | { type: 'error'; requestId: string };

export type ReactionAction =
  | Exclude<PendingAction, { type: 'success' }>
  | { type: 'success'; requestId: string; aggregate: ReactionAggregate }
  | { type: 'server'; aggregate: ReactionAggregate };

/** Regra 1: aceita só `revision >= atual`. Sem atual, aceita qualquer um. */
export function shouldAcceptAggregate(
  current: ReactionAggregate | null,
  incoming: ReactionAggregate,
): boolean {
  if (!current || current.revision === null) return true;
  if (incoming.revision === null) return false;
  return Date.parse(incoming.revision) >= Date.parse(current.revision);
}

export function acceptServerAggregate(
  current: ReactionAggregate | null,
  incoming: ReactionAggregate,
): ReactionAggregate | null {
  return shouldAcceptAggregate(current, incoming) ? incoming : current;
}

export function reducePending(pending: PendingReaction[] = [], action: PendingAction): PendingReaction[] {
  switch (action.type) {
    case 'click':
      return [...pending, { requestId: action.requestId, emoji: action.emoji, status: 'draft' }];
    case 'sent':
      return pending
        .filter((p) => !action.discardedIds.includes(p.requestId))
        .map((p) => (p.requestId === action.requestId ? { ...p, status: 'inflight' as const } : p));
    case 'discarded':
      return pending.filter((p) => !action.requestIds.includes(p.requestId));
    case 'success':
    case 'error':
      // Erro não restaura nada: sem o clique, a bolha volta a mostrar `server`.
      return pending.filter((p) => p.requestId !== action.requestId);
  }
}

export function reduceMessageReactions(
  state: MessageReactionState,
  action: ReactionAction,
): MessageReactionState {
  if (action.type === 'server') {
    return { ...state, server: acceptServerAggregate(state.server, action.aggregate) };
  }
  if (action.type === 'success') {
    return {
      server: acceptServerAggregate(state.server, action.aggregate),
      pending: reducePending(state.pending, { type: 'success', requestId: action.requestId }),
    };
  }
  return { ...state, pending: reducePending(state.pending, action) };
}

/** Emoji atual do operador num agregado, ou `null`. */
export function selfEmoji(reactions: MessageReaction[] | undefined): string | null {
  return reactions?.find((r) => r.reactedByMe)?.emoji ?? null;
}

// Pelo marcador, nunca por nome/telefone nulos: participante anônimo tem o mesmo formato.
const isSelfReactor = (p: MessageReaction['reactors'][number]) => p.isMe;

/**
 * Aplica um gesto do operador por cima do agregado: tira a própria reação do emoji anterior
 * (contagem −1, grupo some no zero) e soma no novo. `null` só remove.
 */
export function applyPendingOverlay(reactions: MessageReaction[], emoji: string | null): MessageReaction[] {
  const next: MessageReaction[] = [];
  for (const r of reactions) {
    if (!r.reactedByMe) {
      next.push(r);
      continue;
    }
    if (r.count <= 1) continue;
    const idx = r.reactors.findIndex(isSelfReactor);
    next.push({
      ...r,
      count: r.count - 1,
      reactedByMe: false,
      reactors: idx < 0 ? r.reactors : r.reactors.filter((_, i) => i !== idx),
    });
  }
  if (emoji === null) return next;

  // Mesmo shape que a API devolve para a reação da própria conta.
  const self = { name: null, phone: null, isMe: true };
  const existing = next.findIndex((r) => r.emoji === emoji);
  if (existing < 0) return [...next, { emoji, count: 1, reactedByMe: true, reactors: [self] }];
  return next.map((r, i) =>
    i === existing ? { ...r, count: r.count + 1, reactedByMe: true, reactors: [...r.reactors, self] } : r,
  );
}

export function displayedReactions(state: MessageReactionState): MessageReaction[] {
  const base = state.server?.reactions ?? [];
  const last = state.pending[state.pending.length - 1];
  return last ? applyPendingOverlay(base, last.emoji) : base;
}

/**
 * Decide o que o despachante envia (regra 3): só o último `draft`; `'skip'` quando o gesto
 * final é igual à base efetiva — alvo do último `inflight`, senão o `self` de `server`.
 */
export function selectReactionToSend(
  server: ReactionAggregate | null,
  inflight: { emoji: string | null }[],
  drafts: { emoji: string | null }[],
): string | null | 'skip' {
  const last = drafts[drafts.length - 1];
  if (!last) return 'skip';
  const base = inflight.length > 0 ? inflight[inflight.length - 1].emoji : selfEmoji(server?.reactions);
  return last.emoji === base ? 'skip' : last.emoji;
}

// ── Adaptação ao estado de mensagens da página ────────────────────────────────

const aggregateOf = (m: ChatMessage): ReactionAggregate => ({
  revision: m.reactionsRevision ?? null,
  reactions: m.reactions ?? [],
});

/**
 * Aplica um agregado de servidor a uma mensagem carregada. Conversa ou mensagem não
 * carregada, ou `revision` menor → devolve `byConversation` intacto (mesma referência).
 * Só a mensagem alvo ganha objeto novo.
 */
export function acceptIntoMessages(
  byConversation: Record<string, ChatMessage[]>,
  conversationId: string,
  messageId: string,
  aggregate: ReactionAggregate,
): Record<string, ChatMessage[]> {
  const list = byConversation[conversationId];
  const idx = list?.findIndex((m) => m.id === messageId) ?? -1;
  if (!list || idx < 0) return byConversation;
  const target = list[idx];
  if (!shouldAcceptAggregate(aggregateOf(target), aggregate)) return byConversation;
  const nextList = list.slice();
  nextList[idx] = { ...target, reactions: aggregate.reactions, reactionsRevision: aggregate.revision };
  return { ...byConversation, [conversationId]: nextList };
}

/**
 * Página do `GET` passa pela mesma regra: se a lista anterior já tem um agregado mais novo
 * da mesma mensagem (vindo por WS), ele fica.
 */
export function keepNewerReactions(previous: ChatMessage[] | undefined, loaded: ChatMessage[]): ChatMessage[] {
  if (!previous?.length) return loaded;
  const prevById = new Map(previous.map((m) => [m.id, m]));
  return loaded.map((m) => {
    const prev = prevById.get(m.id);
    if (!prev || shouldAcceptAggregate(aggregateOf(prev), aggregateOf(m))) return m;
    return { ...m, reactions: prev.reactions, reactionsRevision: prev.reactionsRevision };
  });
}

/** Mensagens com o último gesto pendente por cima; sem pendente, o mesmo objeto. */
export function overlayPending(
  list: ChatMessage[],
  pendingByMessage: Record<string, PendingReaction[]>,
): ChatMessage[] {
  return list.map((m) => {
    const pending = pendingByMessage[m.id];
    if (!pending?.length) return m;
    return { ...m, reactions: displayedReactions({ server: aggregateOf(m), pending }) };
  });
}
