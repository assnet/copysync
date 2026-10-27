/** Grupo da configuração do gerador, pronto para exibição. */
export interface OfferDestinationView {
  conversationId: string;
  /** Nome do grupo. */
  title: string | null;
  /** Foto do grupo (URL pública servida por nós) ou null. */
  avatarUrl: string | null;
  isGroup: boolean;
  sessionId: string | null;
}
