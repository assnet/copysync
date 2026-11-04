// Porta: grupos da sessão no WhatsApp e criação sob demanda da conversa (adapter usa engine + chat).

export interface DirectoryGroup {
  /** Sem `@g.us`, como no chat. */
  groupJid: string;
  name: string | null;
  /** Foto vinda da engine na listagem; vale quando a conversa do chat não tem. */
  avatarUrl?: string | null;
  /** A sessão pode postar no grupo. Ausente = true; false = só monitorar (só-admins ou canal só de leitura). */
  canPost?: boolean;
  postBlockedReason?: GroupPostBlockedReason | null;
  /** A sessão consegue gerar convite. Ausente = true. */
  canInvite?: boolean;
  inviteBlockedReason?: GroupInviteBlockedReason | null;
}

/** ADMINS_ONLY = só admins postam e a sessão não é admin; CHANNEL_READONLY = canal de transmissão sem permissão. */
export type GroupPostBlockedReason = 'ADMINS_ONLY' | 'CHANNEL_READONLY';
export type GroupInviteBlockedReason = 'NOT_ADMIN';

export interface ISessionGroupDirectory {
  /** Grupos de que a sessão participa. Lança AppError interno se a sessão não estiver conectada. */
  listParticipating(sessionId: string): Promise<DirectoryGroup[]>;
  /** Conversa ativa do grupo nesta sessão; cria se ainda não existir. Devolve o id. */
  ensureConversation(tenantId: string, sessionId: string, group: DirectoryGroup): Promise<string>;
}
