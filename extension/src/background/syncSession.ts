import { env, type MarketplaceKey } from '../config/env.js';
import type { SyncState, SyncErrorCode } from './store.js';
import { devError, devLog } from '../core/devLog.js';
import { apiFetch } from './apiFetch.js';
import {
  getSyncState,
  setSyncState,
  getCookieHash,
  setCookieHash,
  getLastSyncEpoch,
  setLastSyncEpoch,
} from './store.js';
import { SyncError, toSyncError } from './errors.js';
import { captureCookies, hasHostPermission } from './marketplaceSession.js';
import { SYNC_RATE_LIMIT_MS } from './constants.js';

/**
 * Marketplace session sync orchestrator (ML e Shein).
 *
 * Tudo é por marketplace: single-flight, `syncState`, hash de cookies e rate limit. Sync da
 * Shein nunca recebe resultado, rate limit nem hash-skip do ML (e vice-versa).
 * Shein sem permissão de host: gatilho automático sai em silêncio; manual/canal acusa
 * `shein_permission_missing`. Nenhum cookie é lido sem a permissão.
 *
 * v3: reads ML_SESSION_COOKIES, hashes for change detection, sends via
 * PUT /api/extension/marketplaces/ml/session with cookie auth.
 * No Bearer, no CSRF (server does bootstrap), no content script.
 *
 * Rate limit: 1 sync per 15min (manual overrides).
 * Triggers: onChanged debounce, reserve alarm 60min, onStartup, manual/channel.
 * Hash skip só em cookie-changed/startup: o alarme de reserva reenvia o mesmo token para o
 * servidor revalidar na loja (o ML pode recusar pelo servidor um token que segue válido aqui).
 */

export type SyncTrigger = 'alarm' | 'manual' | 'channel' | 'cookie-changed' | 'startup';

/** Server path = ML bootstrap (8s) + tag lookup (8s): the default 10s gave up before the server saved. */
const SYNC_TIMEOUT_MS = 25_000;

const HASH_SKIP_TRIGGERS = new Set<SyncTrigger>(['cookie-changed', 'startup']);

const AUTO_TRIGGERS = new Set<SyncTrigger>(['alarm', 'cookie-changed', 'startup']);

const ERRORS: Record<MarketplaceKey, { notLogged: SyncErrorCode; failed: SyncErrorCode }> = {
  ml: { notLogged: 'ml_not_logged', failed: 'ml_sync_failed' },
  shein: { notLogged: 'shein_not_logged', failed: 'shein_sync_failed' },
};

const inFlight: Partial<Record<MarketplaceKey, Promise<SyncState>>> = {};

const execute = async (marketplace: MarketplaceKey, trigger: SyncTrigger): Promise<SyncState> => {
  const previous = await getSyncState(marketplace);

  if (!(await hasHostPermission(marketplace))) {
    if (AUTO_TRIGGERS.has(trigger)) return previous;
    const next: SyncState = { status: 'error', lastSyncAt: previous.lastSyncAt, lastErrorCode: 'shein_permission_missing' };
    await setSyncState(marketplace, next);
    return next;
  }

  await setSyncState(marketplace, { ...previous, status: 'syncing', startedAt: new Date().toISOString() });
  devLog('sync start', marketplace, trigger);

  try {
    // Rate limit (manual and channel bypass)
    if (trigger !== 'manual' && trigger !== 'channel') {
      const lastEpoch = await getLastSyncEpoch(marketplace);
      if (Date.now() - lastEpoch < SYNC_RATE_LIMIT_MS) {
        devLog('sync skip: rate limited');
        const next: SyncState = { status: 'idle', lastSyncAt: previous.lastSyncAt };
        await setSyncState(marketplace, next);
        return next;
      }
    }

    const captured = await captureCookies(marketplace);
    if (!captured) throw new SyncError(ERRORS[marketplace].notLogged);

    // Change detection (manual, channel and reserve alarm bypass)
    if (HASH_SKIP_TRIGGERS.has(trigger)) {
      const prevHash = await getCookieHash(marketplace);
      if (prevHash === captured.hash) {
        devLog('sync skip: unchanged');
        const next: SyncState = { status: 'idle', lastSyncAt: previous.lastSyncAt };
        await setSyncState(marketplace, next);
        return next;
      }
    }

    await apiFetch({
      method: 'PUT',
      path: `/api/extension/marketplaces/${marketplace}/session`,
      body: {
        cookies: captured.cookies,
        capturedAt: new Date().toISOString(),
      },
      timeoutMs: SYNC_TIMEOUT_MS,
    });

    await setCookieHash(marketplace, captured.hash);
    await setLastSyncEpoch(marketplace, Date.now());

    const next: SyncState = { status: 'ok', lastSyncAt: new Date().toISOString() };
    await setSyncState(marketplace, next);
    devLog('sync ok', marketplace, trigger);
    return next;
  } catch (error) {
    const syncError = toSyncError(error, ERRORS[marketplace].failed);
    const next: SyncState = {
      status: 'error',
      lastSyncAt: previous.lastSyncAt,
      lastErrorCode: syncError.code,
      ...(env.isDev && syncError.detail ? { lastErrorDetail: syncError.detail } : {}),
    };
    await setSyncState(marketplace, next);
    devError('sync failed', marketplace, trigger, syncError.code, syncError.detail);
    return next;
  }
};

export const runSync = (trigger: SyncTrigger, marketplace: MarketplaceKey = 'ml'): Promise<SyncState> => {
  const current = inFlight[marketplace];
  if (current) return current;
  const run = execute(marketplace, trigger).finally(() => { delete inFlight[marketplace]; });
  inFlight[marketplace] = run;
  return run;
};
