/** Conversa de grupo candidata a entrar num rodízio. */
export interface LinkRotationGroupCandidate {
  conversationId: string;
  sessionId: string | null;
  /** JID sem `@g.us`. */
  groupJid: string;
  name: string | null;
}

/**
 * Conversas de grupo do tenant (`ChatConversation.isGroup` com `groupJid`). Contrato próprio do
 * rodízio para não depender dos repositórios internos do chat. Filtrado por `tenantId`; conversa
 * que não é grupo (ou sem JID) não volta: quem chama trata a ausência como inválida.
 */
export interface ILinkRotationGroupCatalog {
  findGroups(tenantId: string, conversationIds: readonly string[]): Promise<LinkRotationGroupCandidate[]>;
}
