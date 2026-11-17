import type { GroupMemberInfo } from '../../../../domain/contracts/IMessagingEngine';

/** Par devolvido pelo mapa local da lib (`lid` como foi pedido, `pn` = JID de telefone). */
export interface LocalLidPhonePair {
  lid?: string | null;
  pn?: string | null;
}

/**
 * Busca reversa LID → telefone no mapa LOCAL da lib (cache em memória + key store `lid-mapping` da
 * sessão). Nunca vai à rede: é o único caminho permitido para completar número oculto.
 */
export type LocalLidPhoneLookup = (lidJids: string[]) => Promise<readonly LocalLidPhonePair[] | null | undefined>;

export const LOCAL_LID_LOOKUP_BATCH = 500;

const digitsOf = (jid: string | null | undefined): string | null => {
  const user = jid?.split('@')[0]?.split(':')[0]?.trim();
  return user && /^\d+$/.test(user) ? user : null;
};

/**
 * Completa o telefone de membros só-LID com o que a sessão já aprendeu (mensagens recebidas, histórico,
 * conversas 1:1). Em blocos de 500; bloco que falha fica sem telefone e a leitura segue. Não altera a
 * entrada; membro que já tem telefone não é consultado.
 */
export async function resolveLocalLidPhones(
  members: readonly GroupMemberInfo[],
  lookup: LocalLidPhoneLookup | null | undefined,
  onError?: (err: unknown) => void,
): Promise<GroupMemberInfo[]> {
  const pending = [...new Set(members.filter((m) => !m.phone && m.lid).map((m) => m.lid!))];
  if (!lookup || pending.length === 0) return [...members];

  const phoneByLid = new Map<string, string>();
  for (let i = 0; i < pending.length; i += LOCAL_LID_LOOKUP_BATCH) {
    const slice = pending.slice(i, i + LOCAL_LID_LOOKUP_BATCH);
    try {
      const pairs = await lookup(slice.map((lid) => `${lid}@lid`));
      for (const pair of pairs ?? []) {
        const lid = digitsOf(pair.lid);
        const phone = pair.pn?.endsWith('@lid') ? null : digitsOf(pair.pn);
        if (lid && phone && phone !== lid) phoneByLid.set(lid, phone);
      }
    } catch (err) {
      onError?.(err);
    }
  }
  if (phoneByLid.size === 0) return [...members];
  return members.map((m) => {
    const phone = !m.phone && m.lid ? phoneByLid.get(m.lid) : undefined;
    return phone ? { ...m, phone } : m;
  });
}
