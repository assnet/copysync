/**
 * Lado service worker do proxy: aceita o envelope que o content script `panel-bridge.js`
 * repassa por `chrome.runtime.sendMessage` (mensagem INTERNA) e o entrega à mesma
 * `handleMessage` do canal externo. Só confia em remetente desta extensão, no frame
 * principal, numa origem do painel.
 */
export interface ProxySenderLike {
  id?: string;
  frameId?: number;
  origin?: string;
  url?: string;
  tab?: { url?: string };
}

/** Origem do content script: `sender.origin` → `sender.url` → `sender.tab.url`. */
export const senderOrigin = (s?: ProxySenderLike): string | undefined => {
  if (typeof s?.origin === 'string' && s.origin) return s.origin;
  for (const url of [s?.url, s?.tab?.url]) {
    if (!url) continue;
    try {
      return new URL(url).origin;
    } catch {
      /* próxima fonte */
    }
  }
  return undefined;
};

export const isTrustedProxySender = (
  sender: ProxySenderLike | undefined,
  selfId: string,
  isPanelOrigin: (origin: unknown) => boolean,
): boolean => {
  if (!sender || sender.id !== selfId) return false;
  // Content script é declarado só no frame principal; iframe nunca fala pelo proxy.
  if (typeof sender.frameId === 'number' && sender.frameId !== 0) return false;
  return isPanelOrigin(senderOrigin(sender));
};
