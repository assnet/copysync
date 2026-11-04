/** Grupo de que a sessão participa (engine + conversas já conhecidas do chat). */
export interface LinkRotationSessionGroup {
  /** Sem `@g.us`. */
  groupJid: string;
  title: string | null;
  avatarUrl: string | null;
  /** null = grupo ainda sem conversa no chat (criada ao ser escolhido). */
  conversationId: string | null;
  /** A sessão consegue gerar o convite (é admin). Desconhecido = true. */
  canInvite: boolean;
  /** Motivo de `canInvite === false`. */
  inviteBlockedReason: 'NOT_ADMIN' | null;
}

export interface LinkRotationSessionGroupList {
  groups: LinkRotationSessionGroup[];
  /** true = engine não respondeu; só os grupos que o chat já conhece. */
  partial: boolean;
}

/**
 * Porta para a listagem de grupos da sessão que o gerador de ofertas já tem (mesma regra de
 * merge/busca). Tudo por `tenantId`; sessão fora do tenant → NotFound.
 */
export interface ILinkRotationGroupDirectory {
  listSessionGroups(tenantId: string, sessionId: string, search?: string): Promise<LinkRotationSessionGroupList>;
  /** Conversa do grupo (cria se faltar). Só grupo de que a sessão participa; senão NotFound. */
  ensureConversation(tenantId: string, sessionId: string, groupJid: string): Promise<string>;
}
