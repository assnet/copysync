import type { RemoteChatState } from '../../../../shared/events/InternalMessagingEvent';

/**
 * Campos efetivamente alterados, já com valores finais.
 *
 * Mora aqui, junto da regra que os produz: o contrato do repositório importa deste
 * módulo, e não o contrário — a regra de negócio não deve mudar de forma porque a
 * persistência mudou a dela.
 */
export interface AppliedConversationState {
  unreadCount?: number;
  manuallyUnread?: boolean;
  archived?: boolean;
  pinned?: boolean;
  mutedUntil?: Date | null;
}

/** Recorte persistido que a comparação precisa conhecer. */
export interface CurrentConversationState {
  unreadCount: number;
  manuallyUnread: boolean;
  archived: boolean;
  pinned: boolean;
  mutedUntil: Date | null;
}

/**
 * Decide o que muda ao espelhar o estado vindo de outro aparelho.
 *
 * Regra pura, sem banco: o repositório lê, chama esta função e grava só o que ela
 * devolver. Objeto vazio significa "o estado recebido é igual ao persistido" — e é o
 * que impede o eco das ações do próprio painel de virar gravação e frame de WebSocket.
 *
 * ## Contador: para baixo espelha, para cima não
 *
 * `state.unreadCount` é o total do aparelho e só chega do history sync, que vem em
 * lotes progressivos e sem garantia de ordem. Um lote atrasado carrega um retrato
 * antigo: aplicá-lo cegamente faria o badge ressuscitar numa conversa que o operador
 * acabou de ler — inclusive na conversa aberta na tela.
 *
 * Por isso o total só é adotado quando **reduz** o contador. É a direção em que ele
 * corrige de fato: o painel conta por ingestão de mensagens e superestima, porque conta
 * o que já tinha sido lido no celular antes de a conversa existir aqui. Para cima quem
 * manda é a ingestão, que reage a cada mensagem nova e não depende de sincronização.
 *
 * Conversa lida no outro aparelho chega como `read`, não como total, e zera sempre —
 * esse caminho não é afetado.
 */
export function diffRemoteState(
  current: CurrentConversationState,
  state: RemoteChatState,
): AppliedConversationState {
  const changed: AppliedConversationState = {};

  if (state.read && (current.unreadCount > 0 || current.manuallyUnread)) {
    changed.unreadCount = 0;
    changed.manuallyUnread = false;
  } else if (state.manuallyUnread && !current.manuallyUnread) {
    changed.manuallyUnread = true;
  } else if (state.unreadCount !== undefined && state.unreadCount < current.unreadCount) {
    // Precedência deliberada: `read` e `manuallyUnread` vêm de uma ação explícita do
    // usuário e vencem o total, que é retrato de sincronização. Hoje normalizeChatState
    // nunca produz as duas coisas no mesmo evento — esta ordem é a rede de segurança
    // caso um emissor futuro produza.
    changed.unreadCount = state.unreadCount;
  }

  if (state.archived !== undefined && state.archived !== current.archived) {
    changed.archived = state.archived;
  }

  if (state.pinned !== undefined && state.pinned !== current.pinned) {
    changed.pinned = state.pinned;
  }

  if (state.mutedUntil !== undefined) {
    const atual = current.mutedUntil?.getTime() ?? null;
    const novo = state.mutedUntil?.getTime() ?? null;
    if (atual !== novo) changed.mutedUntil = state.mutedUntil;
  }

  return changed;
}
