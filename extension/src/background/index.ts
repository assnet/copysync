import { MARKETPLACE_KEYS } from '../config/env.js';
import { ML_SYNC_PENDING_ALARM, ML_SYNC_RESERVE_ALARM, SHEIN_SYNC_PENDING_ALARM, HEARTBEAT_ALARM } from './constants.js';
import { devError, devLog } from '../core/devLog.js';
import { registerChannel } from './channel/index.js';
import { setupAlarms, setupUninstallUrl, sendLifecycleEvent, sendHeartbeat, flushPendingLifecycle } from './lifecycle.js';
import { focusPanelTabIfOpen } from './panelTab.js';
import { runSync } from './syncSession.js';
import { getSyncState, setSyncState, getPendingAccess } from './store.js';
import { cookieChangeAlarm, scheduleDebouncedSync } from './cookieWatch.js';
import { handleActionClick } from './actionClick.js';

/**
 * Service worker (MV3) — v3.0.0.
 *
 * No password login. Session via HttpOnly cookie from `POST /session`.
 * Panel communicates via `externally_connectable` channel.
 * Marketplace cookies (ML, Shein) synced via `chrome.cookies.onChanged` + debounce, por marketplace.
 */

// ── Boot ────────────────────────────────────────────────────────────────────
// Toda subida do service worker garante instalação + URL de desinstalação
// (onInstalled/onStartup não disparam em todo wake-up).

// Primeiro passo do boot: espelho da pendência de permissão em memória. O clique no ícone decide
// sem `await` (gesto do usuário); clique antes de carregar só foca o painel (ver actionClick.ts).
void getPendingAccess().catch(() => undefined);
void setupUninstallUrl();

// ── Stale sync reset ────────────────────────────────────────────────────────

const resetStaleSync = async (): Promise<void> => {
  for (const marketplace of MARKETPLACE_KEYS) {
    const state = await getSyncState(marketplace);
    if (state.status === 'syncing') {
      await setSyncState(marketplace, { status: 'idle', lastSyncAt: state.lastSyncAt });
    }
  }
};

// ── Lifecycle events ────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener((details) => {
  void setupAlarms();
  void resetStaleSync();
  void setupUninstallUrl();

  if (details.reason === 'install') {
    void sendLifecycleEvent('INSTALL');
    void focusPanelTabIfOpen().catch((error) => devError('focus panel failed', error));
  } else if (details.reason === 'update') {
    void sendLifecycleEvent('UPDATE', details.previousVersion);
  }
});

chrome.runtime.onStartup.addListener(() => {
  void setupAlarms();
  void resetStaleSync();
  void setupUninstallUrl();
  void flushPendingLifecycle();
  void sendLifecycleEvent('STARTUP');
});

// ── Channel (panel ↔ extension via externally_connectable) ──────────────────

registerChannel();

// ── Alarms ──────────────────────────────────────────────────────────────────

chrome.alarms.onAlarm.addListener((alarm) => {
  switch (alarm.name) {
    case ML_SYNC_PENDING_ALARM:
      void runSync('cookie-changed', 'ml');
      break;
    case SHEIN_SYNC_PENDING_ALARM:
      void runSync('cookie-changed', 'shein');
      break;
    case ML_SYNC_RESERVE_ALARM:
      // Reserva compartilhada: cada marketplace roda isolado (Shein sem permissão sai em silêncio).
      void runSync('alarm', 'ml');
      void runSync('alarm', 'shein');
      break;
    case HEARTBEAT_ALARM:
      void flushPendingLifecycle();
      void sendHeartbeat().then(result => {
        if (result.resyncRequested) void runSync('alarm', 'ml');
      });
      break;
  }
});

// ── Marketplace cookie change detection (domínio E nome, por marketplace) ───

chrome.cookies.onChanged.addListener((changeInfo) => {
  const alarm = cookieChangeAlarm(changeInfo.cookie);
  if (!alarm) return;
  devLog('marketplace cookie changed', alarm, changeInfo.cookie.name, changeInfo.cause);
  void scheduleDebouncedSync(alarm);
});

// ── Icon click → pedido de permissão pendente ou painel ─────────────────────

chrome.action.onClicked.addListener(() => {
  void handleActionClick().catch((error) => devError('icon click failed', error));
});
