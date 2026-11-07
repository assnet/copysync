import { env } from '../config/env.js';
import { devLog } from '../core/devLog.js';
import { apiFetch } from './apiFetch.js';
import { SyncError } from './errors.js';
import {
  clearPendingLifecycle,
  ensureInstallation,
  getPendingLifecycle,
  setPendingLifecycle,
  type PendingLifecycleEvent,
} from './store.js';
import { buildUninstallUrl } from './uninstallUrl.js';
import { HEARTBEAT_ALARM, ML_SYNC_RESERVE_ALARM } from './constants.js';

/**
 * Extension lifecycle: onInstalled, onStartup, heartbeat, uninstall URL.
 *
 * Events sent to `POST /api/extension/lifecycle/event` (public, rate limited).
 * Heartbeat sent to `POST /api/extension/heartbeat` (authenticated).
 */

const HEARTBEAT_INTERVAL_MINUTES = 30;
const RESERVE_SYNC_INTERVAL_MINUTES = 60;
const LIFECYCLE_PATH = '/api/extension/lifecycle/event';

export const setupAlarms = async (): Promise<void> => {
  const hb = await chrome.alarms.get(HEARTBEAT_ALARM);
  if (!hb || hb.periodInMinutes !== HEARTBEAT_INTERVAL_MINUTES) {
    await chrome.alarms.create(HEARTBEAT_ALARM, {
      periodInMinutes: HEARTBEAT_INTERVAL_MINUTES,
      delayInMinutes: 2,
    });
  }

  const reserve = await chrome.alarms.get(ML_SYNC_RESERVE_ALARM);
  if (!reserve || reserve.periodInMinutes !== RESERVE_SYNC_INTERVAL_MINUTES) {
    await chrome.alarms.create(ML_SYNC_RESERVE_ALARM, {
      periodInMinutes: RESERVE_SYNC_INTERVAL_MINUTES,
      delayInMinutes: 5,
    });
  }

  devLog('alarms scheduled');
};

/** Define a URL de desinstalação (cria a instalação se faltar). Não define se a URL for inválida. */
export const setupUninstallUrl = async (): Promise<void> => {
  try {
    const inst = await ensureInstallation();
    const url = buildUninstallUrl(
      env.panelUrl,
      inst.installationId,
      chrome.runtime.id,
      chrome.runtime.getManifest().version,
    );
    if (!url) return;
    await chrome.runtime.setUninstallURL(url);
    devLog('uninstall URL set');
  } catch (error) {
    devLog('uninstall URL failed', error);
  }
};

/** Falha transitória (rede, rate limit, rota ainda ausente, 5xx): vale reenviar. */
const isRetriable = (error: unknown): boolean => {
  if (!(error instanceof SyncError)) return true;
  if (error.code === 'api_rejected') return /^HTTP 5\d\d/.test(error.detail ?? '');
  return error.code === 'api_unreachable' || error.code === 'rate_limited' || error.code === 'api_route_missing';
};

const postLifecycle = (body: PendingLifecycleEvent): Promise<unknown> =>
  apiFetch({ method: 'POST', path: LIFECYCLE_PATH, body });

export const sendLifecycleEvent = async (
  type: 'INSTALL' | 'UPDATE' | 'STARTUP',
  previousVersion?: string,
): Promise<void> => {
  let body: PendingLifecycleEvent;
  try {
    const installation = await ensureInstallation();
    const version = chrome.runtime.getManifest().version;
    const dedupeKey = type === 'INSTALL'
      ? 'INSTALL'
      : type === 'UPDATE' ? `UPDATE:${version}` : `STARTUP:${Date.now()}`;
    body = {
      installationId: installation.installationId,
      type,
      version,
      channel: 'cs-ext',
      dedupeKey,
      extensionId: chrome.runtime.id,
      ...(previousVersion ? { previousVersion } : {}),
    };
  } catch (error) {
    devLog('lifecycle skip', type, error);
    return;
  }

  try {
    await postLifecycle(body);
    if (type === 'INSTALL') await clearPendingLifecycle();
    devLog('lifecycle sent', type);
  } catch (error) {
    if (type === 'INSTALL' && isRetriable(error)) await setPendingLifecycle(body);
    devLog('lifecycle failed (non-blocking)', type, error);
  }
};

/** Reenvia o INSTALL pendente (heartbeat/startup). Limpa no sucesso ou em erro definitivo. */
export const flushPendingLifecycle = async (): Promise<void> => {
  const pending = await getPendingLifecycle();
  if (!pending) return;
  try {
    await postLifecycle(pending);
    await clearPendingLifecycle();
    devLog('lifecycle pending sent', pending.type);
  } catch (error) {
    if (!isRetriable(error)) await clearPendingLifecycle();
    devLog('lifecycle pending failed', pending.type, error);
  }
};

export const sendHeartbeat = async (): Promise<{ resyncRequested?: boolean }> => {
  try {
    const result = await apiFetch<{ ml?: { resyncRequested?: boolean } }>({
      method: 'POST',
      path: '/api/extension/heartbeat',
      body: {
        extVersion: chrome.runtime.getManifest().version,
        ml: { lastSyncAt: undefined },
      },
    });
    return { resyncRequested: result?.ml?.resyncRequested };
  } catch {
    return {};
  }
};
