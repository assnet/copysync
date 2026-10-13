import { env } from '../config/env.js';
import type {
  RuntimeRequest,
  RuntimeResponse,
  AuthSummary,
  SessionStateSnapshot,
  StoredAuth,
} from '../contract/messages.js';
import { devError, devLog } from '../core/devLog.js';
import { login, logout } from './apiClient.js';
import {
  clearAuth,
  getAuth,
  getSettings,
  getSyncState,
  selectTenant,
  setAuth,
  setSettings,
  setSyncState,
} from './authStore.js';
import { SyncError, toSyncError } from './errors.js';
import { checkLogin } from './marketplaceSession.js';
import { runSync } from './syncSession.js';

/**
 * Service worker (MV3). Só registra listeners e despacha para os módulos;
 * nenhuma regra mora aqui.
 */
const SYNC_ALARM = 'affiliate-session-sync';

const ensureAlarm = async (): Promise<void> => {
  const existing = await chrome.alarms.get(SYNC_ALARM);
  if (existing?.periodInMinutes === env.sessionSyncIntervalMinutes) return;
  await chrome.alarms.create(SYNC_ALARM, {
    periodInMinutes: env.sessionSyncIntervalMinutes,
    delayInMinutes: 1,
  });
  devLog('alarm scheduled', env.sessionSyncIntervalMinutes, 'min');
};

/** Service worker (re)iniciou: nenhuma sincronização pode estar em curso. */
const resetStaleSync = async (): Promise<void> => {
  const state = await getSyncState();
  if (state.status === 'syncing') await setSyncState({ status: 'idle', lastSyncAt: state.lastSyncAt });
};

chrome.runtime.onInstalled.addListener(() => {
  void ensureAlarm();
  void resetStaleSync();
});
chrome.runtime.onStartup.addListener(() => {
  void ensureAlarm();
  void resetStaleSync();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== SYNC_ALARM) return;
  void runSync('alarm');
});

const buildSnapshot = async (): Promise<SessionStateSnapshot> => {
  const [auth, settings, sync, marketplace] = await Promise.all([
    getAuth(),
    getSettings(),
    getSyncState(),
    checkLogin(),
  ]);
  // Tokens nunca saem do background: o popup só precisa de usuário e tenants.
  const summary: AuthSummary | null = auth ? { user: auth.user, tenants: auth.tenants, tenantId: auth.tenantId } : null;
  return { auth: summary, settings, sync, marketplace };
};

const handleLogin = async (email: string, password: string): Promise<void> => {
  const result = await login(email.trim(), password);
  if (!result.tenants.length) throw new SyncError('login_no_tenant');
  const auth: StoredAuth = {
    accessToken: result.accessToken,
    refreshToken: result.refreshToken,
    user: { id: result.user.id, name: result.user.name, email: result.user.email },
    tenants: result.tenants,
    tenantId: result.tenants[0].id,
  };
  await setAuth(auth);
};

const handle = async (request: RuntimeRequest): Promise<void> => {
  switch (request.type) {
    case 'auth/login':
      await handleLogin(request.email, request.password);
      return;
    case 'auth/logout': {
      const auth = await getAuth();
      if (auth) await logout(auth);
      await clearAuth();
      return;
    }
    case 'auth/select-tenant': {
      const updated = await selectTenant(request.tenantId);
      if (!updated) throw new SyncError('not_authenticated', 'tenant not in list');
      return;
    }
    case 'session/sync-now':
      await runSync('manual');
      return;
    case 'session/get-state':
    case 'marketplace/check-login':
      return;
    case 'settings/save':
      await setSettings(request.settings);
      return;
    default: {
      const unreachable: never = request;
      throw new SyncError('api_rejected', `unknown request ${JSON.stringify(unreachable)}`);
    }
  }
};

const respond = async (request: RuntimeRequest): Promise<RuntimeResponse> => {
  try {
    await handle(request);
    return { ok: true, state: await buildSnapshot() };
  } catch (error) {
    const syncError = toSyncError(error, 'api_rejected');
    devError('request failed', request.type, syncError.code, syncError.detail);
    return {
      ok: false,
      errorCode: syncError.code,
      ...(env.isDev && syncError.detail ? { detail: syncError.detail } : {}),
    };
  }
};

chrome.runtime.onMessage.addListener((message: RuntimeRequest, sender, sendResponse) => {
  // Só aceita mensagens de páginas da própria extensão (popup). Content script
  // (sender.tab definido) e outras extensões não falam com este canal.
  if (sender.id !== chrome.runtime.id || sender.tab || !message || typeof message.type !== 'string') return false;
  void respond(message).then(sendResponse);
  return true;
});
