import type { DirectoryGroup } from '../contracts/ISessionGroupDirectory';
import type { SessionGroupConversation } from '../contracts/IOfferGeneratorConfigRepository';

export interface SessionGroupItem {
  groupJid: string;
  title: string | null;
  /** Foto vem da conversa do chat; grupo sem conversa não tem. */
  avatarUrl: string | null;
  /** null = grupo ainda sem conversa no chat (criada ao ser escolhido). */
  conversationId: string | null;
}

const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();

/**
 * Junta os grupos do WhatsApp (`live`) com as conversas já existentes. Com `live` (sessão
 * respondeu), vale a lista do WhatsApp: grupo que o usuário deixou some. Sem `live`
 * (sessão fora), sobra o que o chat conhece. Busca sem acento e sem caixa; sem título vai ao fim.
 */
export function mergeSessionGroups(
  live: readonly DirectoryGroup[] | null,
  known: readonly SessionGroupConversation[],
  search?: string,
): SessionGroupItem[] {
  const byJid = new Map<string, SessionGroupConversation>();
  for (const k of known) if (!byJid.has(k.groupJid)) byJid.set(k.groupJid, k);

  const items: SessionGroupItem[] = live
    ? live.map((g) => {
        const k = byJid.get(g.groupJid);
        return { groupJid: g.groupJid, title: g.name ?? k?.title ?? null, avatarUrl: k?.avatarUrl ?? null, conversationId: k?.conversationId ?? null };
      })
    : [...byJid.values()].map((k) => ({ groupJid: k.groupJid, title: k.title, avatarUrl: k.avatarUrl, conversationId: k.conversationId }));

  const term = search ? fold(search) : '';
  const filtered = term ? items.filter((i) => i.title && fold(i.title).includes(term)) : items;

  return filtered.sort((a, b) => {
    if (!a.title) return b.title ? 1 : 0;
    if (!b.title) return -1;
    return a.title.localeCompare(b.title, 'pt-BR', { sensitivity: 'base' });
  });
}
