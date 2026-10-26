/** Grupo da configuração do gerador, pronto para exibição. */
export interface OfferDestinationView {
  conversationId: string;
  /** Nome do grupo. */
  title: string | null;
  isGroup: boolean;
  sessionId: string | null;
}
