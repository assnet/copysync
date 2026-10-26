// Porta de envio da oferta a uma conversa (adapter na infra chama o chat).

export interface SendOfferMessageInput {
  tenantId: string;
  conversationId: string;
  text: string;
  /** URL do media store; null = só texto. */
  imageUrl: string | null;
}

export interface IOfferMessageSender {
  /** Lança AppError interno em falha (conversa ausente, sessão desconectada…). */
  send(input: SendOfferMessageInput): Promise<{ chatMessageId: string }>;
}
