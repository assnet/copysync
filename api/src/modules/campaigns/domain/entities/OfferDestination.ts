/** Conversa marcada pelo tenant como destino padrão das ofertas. */
export interface OfferDestination {
  tenantId: string;
  conversationId: string;
  createdAt: Date;
}

/** Destino pronto para exibição: título = nome do grupo ou do contato. */
export interface OfferDestinationView {
  conversationId: string;
  title: string | null;
  isGroup: boolean;
  sessionId: string | null;
  sessionName?: string | null;
}
