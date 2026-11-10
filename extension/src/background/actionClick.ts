import { MARKETPLACES, type MarketplaceKey } from '../config/env.js';
import { devError, devLog } from '../core/devLog.js';
import { focusOrOpenPanel } from './panelTab.js';
import { clearPendingAccess, getPendingAccess, peekPendingAccess } from './store.js';
import { runSync } from './syncSession.js';

/**
 * Clique no ícone (`chrome.action.onClicked`) — plano A do spike T9.
 *
 * `chrome.permissions.request` só é aceito durante o gesto: com pendência de
 * `shein.requestAccess` o pedido é a PRIMEIRA chamada, síncrona, lida do espelho em memória
 * (`peekPendingAccess`). Concedida: limpa a pendência, sincroniza e foca o painel. Negada: limpa
 * e foca. Sem pendência: só foca/abre o painel, como antes.
 * Worker recém-acordado (espelho não lido): lê o storage e tenta; se o Chrome recusar por falta
 * de gesto, a pendência fica e o próximo clique (worker já vivo) pede.
 */

const requestOrigins = (marketplace: MarketplaceKey): Promise<boolean> => {
  try {
    return chrome.permissions.request({ origins: [MARKETPLACES[marketplace].MARKETPLACE_URL_PATTERN] });
  } catch (error) {
    return Promise.reject(error);
  }
};

const finish = async (marketplace: MarketplaceKey, request: Promise<boolean>): Promise<void> => {
  let granted: boolean;
  try {
    granted = await request;
  } catch (error) {
    devError('permission request failed', marketplace, error);
    await focusOrOpenPanel();
    return;
  }
  await clearPendingAccess();
  devLog('permission request', marketplace, granted ? 'granted' : 'denied');
  if (granted) void runSync('manual', marketplace);
  await focusOrOpenPanel();
};

export const handleActionClick = (): Promise<void> => {
  const pending = peekPendingAccess();
  if (pending) return finish(pending.marketplace, requestOrigins(pending.marketplace));
  if (pending === null) return focusOrOpenPanel();
  return (async () => {
    const loaded = await getPendingAccess();
    if (!loaded) return focusOrOpenPanel();
    return finish(loaded.marketplace, requestOrigins(loaded.marketplace));
  })();
};
