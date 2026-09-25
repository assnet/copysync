import type { ChatMessageReaction } from '../entities/ChatMessageReaction';
import type { ReactionWriteDecision } from '../services/decideReactionWrite';

export interface ApplyReactionInput {
  tenantId: string;
  messageId: string;
  reactorKey: string;
  /** null = remover (grava tombstone). */
  emoji: string | null;
  reactorPhone: string | null;
  reactorName: string | null;
  fromMe: boolean;
  externalId: string | null;
  reactedAt: Date;
}

/**
 * `applied`: a linha foi gravada (evento não era mais antigo que o estado).
 * `changed`: o estado visível (emoji ativo) mudou — só então alguém publica no WS.
 */
export type ApplyReactionResult = ReactionWriteDecision;

export interface IChatMessageReactionRepository {
  /**
   * Única porta de escrita: set e remoção por last-write-wins em `reactedAt`, serializado
   * por (mensagem, autor). A decisão é de `decideReactionWrite` (domínio); o repositório
   * só a executa. Não criar `upsert`/`remove` separados — um `DELETE` reabriria o problema
   * de ordem que o tombstone resolve.
   */
  apply(input: ApplyReactionInput): Promise<ApplyReactionResult>;
  /** Linhas da mensagem, tombstones incluídos (entram na `revision`). */
  findByMessageId(messageId: string, tenantId: string): Promise<ChatMessageReaction[]>;
  /** Lote — evita N+1 na listagem de mensagens. Tombstones incluídos. */
  findByMessageIds(messageIds: string[], tenantId: string): Promise<ChatMessageReaction[]>;
}
