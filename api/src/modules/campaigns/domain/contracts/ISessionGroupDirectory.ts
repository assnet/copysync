// Porta: grupos da sessão no WhatsApp e criação sob demanda da conversa (adapter usa engine + chat).

export interface DirectoryGroup {
  /** Sem `@g.us`, como no chat. */
  groupJid: string;
  name: string | null;
}

export interface ISessionGroupDirectory {
  /** Grupos de que a sessão participa. Lança AppError interno se a sessão não estiver conectada. */
  listParticipating(sessionId: string): Promise<DirectoryGroup[]>;
  /** Conversa ativa do grupo nesta sessão; cria se ainda não existir. Devolve o id. */
  ensureConversation(tenantId: string, sessionId: string, group: DirectoryGroup): Promise<string>;
}
