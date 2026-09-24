import type { RemoteChatState } from '../../../../shared/events/InternalMessagingEvent';

/** Campos de estado que uma conversa pode já nascer com. */
export interface InitialConversationState {
  unreadCount?: number;
  manuallyUnread?: boolean;
  archived?: boolean;
  pinned?: boolean;
  mutedUntil?: Date | null;
}

/**
 * Converte o retrato que o aparelho manda no history sync no estado inicial da conversa.
 *
 * Existe porque os dois caminhos de sincronização rodam fora de ordem: o estado é
 * emitido assim que o lote chega, enquanto as mensagens são ingeridas em background.
 * Para a conversa que ainda não existe, o espelhamento não tem o que atualizar e o
 * estado se perderia — ela nasceria desarquivada, sem fixação, sem silenciamento e como
 * lida, e nada a corrigiria depois (a reconciliação do contador é monotônica para baixo,
 * e arquivamento/fixação só chegam quando mudam).
 *
 * Semear na criação é seguro justamente por acontecer uma vez: não há estado anterior
 * para atropelar nem leitura do operador para ignorar.
 */
export function initialStateFromRemote(state: RemoteChatState): InitialConversationState {
  const initial: InitialConversationState = {};

  // `read` e o total são excludentes na origem; `read` significa zero não lidas.
  if (state.read) initial.unreadCount = 0;
  else if (state.unreadCount !== undefined) initial.unreadCount = state.unreadCount;

  if (state.manuallyUnread) initial.manuallyUnread = true;
  if (state.archived !== undefined) initial.archived = state.archived;
  if (state.pinned !== undefined) initial.pinned = state.pinned;
  if (state.mutedUntil !== undefined) initial.mutedUntil = state.mutedUntil;

  return initial;
}
