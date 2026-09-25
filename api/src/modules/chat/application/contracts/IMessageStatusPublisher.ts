import type { ChatMessageStatus } from '../../domain/enums/ChatMessageEnums';

/** Mudança de status de uma mensagem, pronta para o evento em tempo real. */
export interface MessageStatusUpdatedEvent {
  tenantId: string;
  conversationId: string;
  messageId: string;
  /** `SENT`/`FAILED` no fluxo de mídia; `PENDING` nunca é publicado. */
  status: ChatMessageStatus;
}

/**
 * Porta de publicação do `chat.message.status.updated`. Existe para o despacho, o retry e a
 * recuperação não dependerem do publisher de WebSocket (infraestrutura); o wiring liga esta
 * porta ao `chatWsPublisher`. Publicar só depois que a transição de status de fato ocorreu.
 */
export interface IMessageStatusPublisher {
  publishStatusUpdated(event: MessageStatusUpdatedEvent): void;
}
