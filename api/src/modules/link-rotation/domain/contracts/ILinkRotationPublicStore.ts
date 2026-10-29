/** Nomes exibidos na página pública (fallback do título e nome do grupo). */
export interface LinkRotationPublicLabels {
  sessionName: string | null;
  groupName: string | null;
  /** URL pública da foto do grupo (armazenamento de mídia), ou null. */
  groupAvatarUrl: string | null;
}

/**
 * Persistência da rota pública além de `ILinkRotationRepository` (contrato próprio da resolução
 * pública). Tudo filtrado por `tenantId` da rotação já resolvida pelo Host.
 */
export interface ILinkRotationPublicStore {
  /** Já existe clique com o mesmo `ipHash` na rotação desde `since` (dedupe de 10 min). */
  hasRecentClick(tenantId: string, rotationId: string, ipHash: string, since: Date): Promise<boolean>;
  /**
   * Grava `allFullNotifiedAt = at` só se estiver null ou anterior a `staleBefore` (condicional,
   * atômico: duas requisições simultâneas gravam uma vez). Devolve true se gravou.
   */
  markAllFullNotified(tenantId: string, rotationId: string, at: Date, staleBefore: Date): Promise<boolean>;
  /** Nome da sessão dona e do grupo escolhido (`conversationId` null = só a sessão). */
  findLabels(tenantId: string, sessionId: string, conversationId: string | null): Promise<LinkRotationPublicLabels>;
}
