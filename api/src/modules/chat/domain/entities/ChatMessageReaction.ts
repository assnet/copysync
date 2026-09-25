/**
 * Reação de um autor a uma mensagem. Uma linha por (mensagem, autor).
 *
 * `emoji: null` é tombstone: a reação foi removida, mas a linha fica para guardar o
 * carimbo (`reactedAt`) da remoção — sem ela, um set atrasado não teria com o que
 * comparar e ressuscitaria a reação. Os `find*` do repositório devolvem tombstones:
 * entram na `revision` do agregado, nunca na lista de chips.
 */
export interface ChatMessageReaction {
  id: string;
  tenantId: string;
  messageId: string;
  /** null = tombstone (reação removida). Nunca string vazia. */
  emoji: string | null;
  /** "self" para a nossa conta; senão a identidade crua do protocolo ("lid:…" ou "pn:…"). */
  reactorKey: string;
  /** Telefone do autor quando conhecido (null com privacidade de número). */
  reactorPhone: string | null;
  /** Nome exibido do autor no momento da reação. */
  reactorName: string | null;
  /** true = reação emitida pela nossa própria conta (painel ou celular do operador). */
  fromMe: boolean;
  /** Id externo da mensagem de reação — usado para descartar reprocessamento. */
  externalId: string | null;
  /** Carimbo de ordem do gesto (last-write-wins). */
  reactedAt: Date;
  createdAt: Date;
  /** Última escrita da linha (tombstone incluído) — o maior vira a `revision` do agregado. */
  updatedAt: Date;
}
