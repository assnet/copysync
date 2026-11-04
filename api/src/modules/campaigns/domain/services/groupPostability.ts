import type { DirectoryGroup, GroupPostBlockedReason } from '../contracts/ISessionGroupDirectory';

/** Permissão de postar de um grupo salvo. `canPost` null = desconhecido (sessão fora/lista indisponível). */
export interface GroupPostability {
  canPost: boolean | null;
  postBlockedReason: GroupPostBlockedReason | null;
}

export const UNKNOWN_POSTABILITY: GroupPostability = { canPost: null, postBlockedReason: null };

/** Lista ao vivo por sessão; null = a sessão não respondeu. */
export type LiveGroupsBySession = ReadonlyMap<string, readonly DirectoryGroup[] | null>;

/**
 * Cruza o grupo salvo com a lista ao vivo da sessão dona. Sem lista, sem sessão ou grupo fora
 * da lista (sessão saiu dele) → desconhecido: o envio é quem recusa de fato.
 */
export function postabilityOf(live: LiveGroupsBySession, sessionId: string | null, groupJid: string | null): GroupPostability {
  if (!sessionId || !groupJid) return UNKNOWN_POSTABILITY;
  const g = live.get(sessionId)?.find((x) => x.groupJid === groupJid);
  if (!g) return UNKNOWN_POSTABILITY;
  const canPost = g.canPost ?? true;
  return { canPost, postBlockedReason: canPost ? null : (g.postBlockedReason ?? 'ADMINS_ONLY') };
}
