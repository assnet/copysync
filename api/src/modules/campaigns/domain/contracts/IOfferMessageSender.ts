// Porta de envio da oferta a uma conversa (adapter na infra chama o chat).

export interface SendOfferMessageInput {
  tenantId: string;
  conversationId: string;
  text: string;
  /** URL do media store; null = só texto. */
  imageUrl: string | null;
  /** Em grupo: menciona todos os participantes (menção oculta, sem `@` no texto). */
  mentionAll: boolean;
  /** Mostra "digitando…" por `typingSeconds` antes da mensagem. Melhor esforço. */
  simulateTyping: boolean;
  typingSeconds: number;
}

export interface IOfferMessageSender {
  /** Lança AppError interno em falha (conversa ausente, sessão desconectada…). */
  send(input: SendOfferMessageInput): Promise<{ chatMessageId: string }>;
}
