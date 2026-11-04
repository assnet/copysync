import type { DirectoryGroup } from '../../domain/contracts/ISessionGroupDirectory';
import type { LiveGroupsBySession } from '../../domain/services/groupPostability';

/** Teto por sessão: a tela de configuração não espera engine travada. */
export const LIVE_GROUPS_TIMEOUT_MS = 4_000;

/**
 * Lista ao vivo dos grupos de cada sessão, em paralelo. Erro, sessão fora ou estouro do prazo →
 * null para aquela sessão (nunca lança). As engines têm cache curto da lista.
 */
export async function loadLiveGroups(
  sessionIds: readonly (string | null)[],
  list: (sessionId: string) => Promise<readonly DirectoryGroup[]>,
  timeoutMs = LIVE_GROUPS_TIMEOUT_MS,
): Promise<LiveGroupsBySession> {
  const ids = [...new Set(sessionIds.filter((id): id is string => !!id))];
  const entries = await Promise.all(ids.map(async (id) => {
    let timer: NodeJS.Timeout | undefined;
    try {
      const groups = await Promise.race([
        list(id),
        new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), timeoutMs); }),
      ]);
      return [id, groups] as const;
    } catch {
      return [id, null] as const;
    } finally {
      clearTimeout(timer);
    }
  }));
  return new Map(entries);
}
