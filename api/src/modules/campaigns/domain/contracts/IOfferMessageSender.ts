// Porta de envio da oferta a uma conversa (adapter na infra chama o chat).

import type { OfferImageMode } from '../enums/OfferImageMode';

export interface SendOfferMessageInput {
  tenantId: string;
  conversationId: string;
  text: string;
  /** URL do media store; null = só texto. */
  imageUrl: string | null;
  /** MEDIA = foto com legenda; LINK_PREVIEW = texto com prévia do link (docs/mensagens-previa-de-link.md). */
  imageMode: OfferImageMode;
  /** Título do cartão de prévia; null = sem prévia. */
  title: string | null;
  /** Link de afiliado da oferta (escolha do link da prévia). */
  affiliateUrl: string;
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
