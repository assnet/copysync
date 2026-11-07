import { env } from '../config/env.js';

/**
 * Aba do painel por URL. Usa a origem do painel em host_permissions (sem permissão `tabs`).
 * Janela atual primeiro, depois qualquer janela.
 */
const findPanelTab = async (): Promise<chrome.tabs.Tab | undefined> => {
  const pattern = `${new URL(env.panelUrl).origin}/*`;
  const [inCurrent] = await chrome.tabs.query({ url: pattern, lastFocusedWindow: true });
  return inCurrent ?? (await chrome.tabs.query({ url: pattern }))[0];
};

const focusTab = async (tab: chrome.tabs.Tab & { id: number }): Promise<void> => {
  await chrome.tabs.update(tab.id, { active: true });
  await chrome.windows.update(tab.windowId, { focused: true });
};

/** Clique no ícone: reaproveita a aba aberta do painel ou abre uma nova. */
export const focusOrOpenPanel = async (): Promise<void> => {
  const tab = await findPanelTab();
  if (tab?.id === undefined) {
    await chrome.tabs.create({ url: env.panelUrl });
    return;
  }
  await focusTab({ ...tab, id: tab.id });
};

/** Primeira instalação: foca a aba do painel se já estiver aberta; não abre aba nova. */
export const focusPanelTabIfOpen = async (): Promise<boolean> => {
  if (!env.panelUrl) return false;
  const tab = await findPanelTab();
  if (tab?.id === undefined) return false;
  await focusTab({ ...tab, id: tab.id });
  return true;
};
