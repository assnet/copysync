import { env } from '../config/env.js';
import { devLog } from '../core/devLog.js';
import { apiFetch } from './apiFetch.js';
import { getInstallation } from './store.js';
import { HEARTBEAT_ALARM, ML_SYNC_RESERVE_ALARM } from './constants.js';

/**
 * Extension lifecycle: onInstalled, onStartup, heartbeat, uninstall URL.
 *
 * Events sent to `POST /api/extension/lifecycle/event` (public, rate limited).
 * Heartbeat sent to `POST /api/extension/heartbeat` (authenticated).
 */

const HEARTBEAT_INTERVAL_MINUTES = 30;
const RESERVE_SYNC_INTERVAL_MINUTES = 60;

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

export const setupUninstallUrl = (): void => {
  const installation = undefined; // async, set below
  void getInstallation().then(inst => {
    if (!inst) return;
    const url = `${env.panelUrl}/extension-removed?i=${encodeURIComponent(inst.installationId)}&e=${encodeURIComponent(inst.extensionId)}&v=${encodeURIComponent(chrome.runtime.getManifest().version)}`;
    chrome.runtime.setUninstallURL(url);
    devLog('uninstall URL set');
  });
};

export const sendLifecycleEvent = async (
  type: 'INSTALL' | 'UPDATE' | 'STARTUP',
  previousVersion?: string,
): Promise<void> => {
  const installation = await getInstallation();
  if (!installation) {
    devLog('lifecycle skip: no installation');
    return;
  }

  const version = chrome.runtime.getManifest().version;
  const dedupeKey = type === 'UPDATE' || type === 'INSTALL'
    ? `${type}:${version}`
    : `${type}:${Date.now()}`;

  try {
    await apiFetch({
      method: 'POST',
      path: '/api/extension/lifecycle/event',
      body: {
        installationId: installation.installationId,
        type,
        version,
        dedupeKey,
        ...(previousVersion ? { previousVersion } : {}),
      },
    });
    devLog('lifecycle sent', type);
  } catch (error) {
    devLog('lifecycle failed (non-blocking)', type, error);
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
