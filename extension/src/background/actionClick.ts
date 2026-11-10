import { MARKETPLACES, type MarketplaceKey } from '../config/env.js';
import { devError, devLog } from '../core/devLog.js';
import { focusOrOpenPanel } from './panelTab.js';
import { clearPendingAccess, peekPendingAccess } from './store.js';
import { runSync } from './syncSession.js';

/**
 * Clique no ícone (`chrome.action.onClicked`) — plano A do spike T9.
 *
 * `chrome.permissions.request` só é aceito durante o gesto: com pendência de
 * `shein.requestAccess` o pedido é a PRIMEIRA chamada, síncrona, lida do espelho em memória
 * (`peekPendingAccess`). Concedida: limpa a pendência, sincroniza e foca o painel. Negada: limpa
 * e foca. Sem pendência: só foca/abre o painel, como antes.
 * Worker recém-acordado (espelho ainda não lido — `index.ts` o carrega no boot, antes dos
 * listeners): NÃO faz `await` antes do pedido, que perderia o gesto. Só foca o painel e mantém a
 * pendência no storage; o próximo clique (espelho já carregado) faz o pedido.
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
  // `null` = sem pendência; `undefined` = espelho não carregado (pendência fica para o próximo clique).
  return focusOrOpenPanel();
};
