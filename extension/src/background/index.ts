import { MARKETPLACE_COOKIE_DOMAIN, env } from '../config/env.js';
import { ML_SESSION_COOKIES, ML_SYNC_PENDING_ALARM, ML_SYNC_RESERVE_ALARM, SYNC_DEBOUNCE_MS, HEARTBEAT_ALARM } from './constants.js';
import { devError, devLog } from '../core/devLog.js';
import { registerChannel } from './channel/index.js';
import { setupAlarms, setupUninstallUrl, sendLifecycleEvent, sendHeartbeat } from './lifecycle.js';
import { runSync } from './syncSession.js';
import { getSyncState, setSyncState } from './store.js';
import { getMlStatus } from './marketplaceSession.js';

/**
 * Service worker (MV3) — v3.0.0.
 *
 * No password login. Session via HttpOnly cookie from `POST /session`.
 * Panel communicates via `externally_connectable` channel.
 * ML cookies synced via `chrome.cookies.onChanged` + debounce.
 */

// ── Stale sync reset ────────────────────────────────────────────────────────

const resetStaleSync = async (): Promise<void> => {
  const state = await getSyncState();
  if (state.status === 'syncing') {
    await setSyncState({ status: 'idle', lastSyncAt: state.lastSyncAt });
  }
};

// ── Lifecycle events ────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener((details) => {
  void setupAlarms();
  void resetStaleSync();
  void setupUninstallUrl();

  if (details.reason === 'install') {
    void sendLifecycleEvent('INSTALL');
  } else if (details.reason === 'update') {
    void sendLifecycleEvent('UPDATE', details.previousVersion);
  }
});

chrome.runtime.onStartup.addListener(() => {
  void setupAlarms();
  void resetStaleSync();
  void setupUninstallUrl();
  void sendLifecycleEvent('STARTUP');
});

// ── Channel (panel ↔ extension via externally_connectable) ──────────────────

registerChannel();

// ── Alarms ──────────────────────────────────────────────────────────────────

chrome.alarms.onAlarm.addListener((alarm) => {
  switch (alarm.name) {
    case ML_SYNC_PENDING_ALARM:
      void runSync('cookie-changed');
      break;
    case ML_SYNC_RESERVE_ALARM:
      void runSync('alarm');
      break;
    case HEARTBEAT_ALARM:
      void sendHeartbeat().then(result => {
        if (result.resyncRequested) void runSync('alarm');
      });
      break;
  }
});

// ── ML cookie change detection ──────────────────────────────────────────────

const ML_COOKIE_SET = new Set<string>(ML_SESSION_COOKIES);

chrome.cookies.onChanged.addListener((changeInfo) => {
  if (changeInfo.cookie.domain.replace(/^\./, '') !== MARKETPLACE_COOKIE_DOMAIN.replace(/^\./, '')) return;
  if (!ML_COOKIE_SET.has(changeInfo.cookie.name)) return;

  devLog('ml cookie changed', changeInfo.cookie.name, changeInfo.cause);

  void chrome.alarms.get(ML_SYNC_PENDING_ALARM).then(existing => {
    if (existing) return;
    chrome.alarms.create(ML_SYNC_PENDING_ALARM, { delayInMinutes: SYNC_DEBOUNCE_MS / 60_000 });
  });
});

// ── Icon click → open panel ────────────────────────────────────────────────

// Reuses an open panel tab (current window first) instead of stacking new ones.
// Needs the panel origin in host_permissions to match tabs by URL (no `tabs` permission).
const focusOrOpenPanel = async (): Promise<void> => {
  const pattern = `${new URL(env.panelUrl).origin}/*`;
  const [inCurrent] = await chrome.tabs.query({ url: pattern, lastFocusedWindow: true });
  const tab = inCurrent ?? (await chrome.tabs.query({ url: pattern }))[0];

  if (tab?.id === undefined) {
    await chrome.tabs.create({ url: env.panelUrl });
    return;
  }
  await chrome.tabs.update(tab.id, { active: true });
  await chrome.windows.update(tab.windowId, { focused: true });
};

chrome.action.onClicked.addListener(() => {
  void focusOrOpenPanel().catch((error) => devError('open panel failed', error));
});
