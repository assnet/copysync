import { MARKETPLACE_COOKIE_DOMAIN } from '../config/env.js';
import { ML_SESSION_COOKIES, ML_SYNC_PENDING_ALARM, ML_SYNC_RESERVE_ALARM, SYNC_DEBOUNCE_MS, HEARTBEAT_ALARM } from './constants.js';
import { devError, devLog } from '../core/devLog.js';
import { registerChannel } from './channel/index.js';
import { setupAlarms, setupUninstallUrl, sendLifecycleEvent, sendHeartbeat } from './lifecycle.js';
import { runSync } from './syncSession.js';
import { getSyncState, setSyncState, getSettings, setSettings, type StoredSettings } from './store.js';
import type { MlStatusPayload } from '../contract/channel.js';
import { getMlStatus } from './marketplaceSession.js';
import { resolverSessao, getCachedProfile, type ExtensionProfile } from './sessionResolver.js';

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

// ── Internal messages (popup only) ──────────────────────────────────────────

interface PopupRequest {
  type: string;
  settings?: Partial<StoredSettings>;
}

interface PopupAuth {
  email: string;
  name: string;
  mlTenantId: string | null;
}

interface PopupResponse {
  ok: boolean;
  auth?: PopupAuth | null;
  settings?: StoredSettings;
  sync?: import('./store.js').SyncState;
  ml?: MlStatusPayload;
}

chrome.runtime.onMessage.addListener(
  (message: PopupRequest, sender, sendResponse: (r: PopupResponse) => void) => {
    if (sender.id !== chrome.runtime.id || sender.tab) return false;
    if (!message || typeof message.type !== 'string') return false;

    const profileToAuth = (p: ExtensionProfile | null): PopupAuth | null =>
      p ? { email: p.user.email, name: p.user.name, mlTenantId: p.mlTenantId } : null;

    const handle = async (): Promise<PopupResponse> => {
      switch (message.type) {
        case 'popup/get-state': {
          let profile: ExtensionProfile | null = null;
          try { profile = await resolverSessao(); } catch { /* not authed */ }
          const [settings, sync, ml] = await Promise.all([getSettings(), getSyncState(), getMlStatus()]);
          return { ok: true, auth: profileToAuth(profile), settings, sync, ml };
        }
        case 'popup/sync-now': {
          await runSync('manual');
          const [sync, ml] = await Promise.all([getSyncState(), getMlStatus()]);
          return { ok: true, sync, ml };
        }
        case 'popup/save-settings': {
          if (message.settings) await setSettings(message.settings);
          const settings = await getSettings();
          return { ok: true, settings };
        }
        default:
          return { ok: false };
      }
    };

    void handle().then(sendResponse).catch(() => sendResponse({ ok: false }));
    return true;
  },
);
