import type { ReactionSummary } from '../../domain/services/aggregateReactions';

/** Agregado completo das reações de uma mensagem, pronto para o evento em tempo real. */
export interface ReactionUpdatedEvent {
  tenantId: string;
  conversationId: string;
  messageId: string;
  reactionsRevision: string | null;
  reactions: ReactionSummary[];
}

/**
 * Porta de publicação do `chat.message.reaction.updated`. Existe para o use case não depender
 * do publisher de WebSocket (infraestrutura); o wiring liga esta porta ao `chatWsPublisher`.
 */
export interface IReactionUpdatePublisher {
  publishReactionUpdated(event: ReactionUpdatedEvent): void;
}
