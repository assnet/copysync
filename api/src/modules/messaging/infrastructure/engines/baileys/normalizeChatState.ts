import type { RemoteChatState } from '../../../../../shared/events/InternalMessagingEvent';

/**
 * Recorte do objeto de chat entregue pelo Baileys em chats.update, chats.upsert e
 * messaging-history.set. Declarado aqui para que a normalização não dependa dos tipos
 * internos da lib (AGENTS.md §9/§11).
 */
export interface RawChatState {
  archived?: boolean | null;
  /** 0 = lida, negativo = marcada como não lida, positivo = delta de mensagens novas. */
  unreadCount?: number | null;
  /** Timestamp de quando foi fixada, ou null/ausente quando não está. */
  pinned?: NumberLike;
  /** Epoch em milissegundos até quando fica silenciada, ou null/ausente. */
  muteEndTime?: NumberLike;
}

/**
 * Campos de tempo chegam como número ou como Long do protobuf, dependendo de o valor
 * ter vindo de app-state ou de history sync. Aceitar os dois aqui evita importar o
 * tipo da lib fora do adapter.
 */
export type NumberLike = number | { toNumber(): number } | null | undefined;

function toNumber(value: NumberLike): number | null {
  if (value === null || value === undefined) return null;
  return typeof value === 'number' ? value : value.toNumber();
}

/**
 * De onde veio o estado, o que muda a leitura do contador.
 *
 * - `update`: chats.update, onde o número positivo é **incremento** (o event-buffer da
 *   lib soma esses valores) — descartado, porque o contador do painel já é mantido pela
 *   ingestão de mensagens e copiá-lo duplicaria a contagem
 * - `history`: messaging-history.set, único lugar que entrega o **total** do aparelho.
 *   É o que reconcilia o passivo: na sincronização inicial de app-state, conversa já
 *   lida chega com unreadCount null (a lib trata "lida" como padrão), então sem esta
 *   fonte o contador acumulado antes da conexão nunca seria corrigido
 */
export type ChatStateSource = 'update' | 'history';

/**
 * Traduz o estado cru do Baileys para o contrato interno.
 *
 * Esta é a única função que conhece a semântica numérica da lib:
 *
 * | Valor de unreadCount | Significado no Baileys              | Resultado      |
 * | -------------------- | ----------------------------------- | -------------- |
 * | ausente / null       | sem informação                      | ignorado       |
 * | 0                    | markChatAsReadAction com read: true | read           |
 * | negativo             | markChatAsReadAction com read: false| manuallyUnread |
 * | positivo             | delta de mensagens novas            | ignorado       |
 *
 * O positivo é descartado porque em chats.update ele é **incremento**, não total (o
 * event-buffer da lib soma esses valores), e o contador do painel já é mantido pela
 * ingestão de mensagens. Copiá-lo duplicaria a contagem.
 *
 * Devolve objeto vazio quando nada aproveitável chegou — o chamador não deve emitir
 * evento nesse caso.
 */
export function normalizeChatState(
  raw: RawChatState,
  options: { now?: number; source?: ChatStateSource } = {},
): RemoteChatState {
  const now = options.now ?? Date.now();
  const source = options.source ?? 'update';
  const state: RemoteChatState = {};

  if (typeof raw.unreadCount === 'number') {
    if (raw.unreadCount === 0) state.read = true;
    else if (raw.unreadCount < 0) state.manuallyUnread = true;
    else if (source === 'history') state.unreadCount = raw.unreadCount;
  }

  if (raw.archived !== undefined && raw.archived !== null) {
    state.archived = raw.archived;
  }

  if (raw.pinned !== undefined) {
    // O Baileys envia o timestamp da fixação, e null quando deixa de estar fixada.
    const ts = toNumber(raw.pinned);
    state.pinned = ts !== null && ts > 0;
  }

  if (raw.muteEndTime !== undefined) {
    const ts = toNumber(raw.muteEndTime);
    // Silenciamento expirado equivale a não silenciada: o painel não mantém timer.
    state.mutedUntil = ts !== null && ts > now ? new Date(ts) : null;
  }

  return state;
}

/** true quando não há nada a espelhar — evita emitir evento vazio. */
export function isEmptyChatState(state: RemoteChatState): boolean {
  return Object.keys(state).length === 0;
}
