import { env } from '../config/env.js';
import type { SyncState } from './store.js';
import { devError, devLog } from '../core/devLog.js';
import { apiFetch } from './apiFetch.js';
import {
  getSyncState,
  setSyncState,
  getMlCookieHash,
  setMlCookieHash,
  getLastSyncEpoch,
  setLastSyncEpoch,
} from './store.js';
import { SyncError, toSyncError } from './errors.js';
import { captureMlCookies } from './marketplaceSession.js';
import { SYNC_RATE_LIMIT_MS } from './constants.js';

/**
 * ML session sync orchestrator.
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

let inFlight: Promise<SyncState> | null = null;

const execute = async (trigger: SyncTrigger): Promise<SyncState> => {
  const previous = await getSyncState();
  await setSyncState({ ...previous, status: 'syncing', startedAt: new Date().toISOString() });
  devLog('sync start', trigger);

  try {
    // Rate limit (manual and channel bypass)
    if (trigger !== 'manual' && trigger !== 'channel') {
      const lastEpoch = await getLastSyncEpoch();
      if (Date.now() - lastEpoch < SYNC_RATE_LIMIT_MS) {
        devLog('sync skip: rate limited');
        const next: SyncState = { status: 'idle', lastSyncAt: previous.lastSyncAt };
        await setSyncState(next);
        return next;
      }
    }

    const captured = await captureMlCookies();
    if (!captured) throw new SyncError('ml_not_logged');

    // Change detection (manual, channel and reserve alarm bypass)
    if (HASH_SKIP_TRIGGERS.has(trigger)) {
      const prevHash = await getMlCookieHash();
      if (prevHash === captured.hash) {
        devLog('sync skip: unchanged');
        const next: SyncState = { status: 'idle', lastSyncAt: previous.lastSyncAt };
        await setSyncState(next);
        return next;
      }
    }

    await apiFetch({
      method: 'PUT',
      path: '/api/extension/marketplaces/ml/session',
      body: {
        cookies: captured.cookies,
        capturedAt: new Date().toISOString(),
      },
      timeoutMs: SYNC_TIMEOUT_MS,
    });

    await setMlCookieHash(captured.hash);
    await setLastSyncEpoch(Date.now());

    const next: SyncState = { status: 'ok', lastSyncAt: new Date().toISOString() };
    await setSyncState(next);
    devLog('sync ok', trigger);
    return next;
  } catch (error) {
    const syncError = toSyncError(error, 'ml_sync_failed');
    const next: SyncState = {
      status: 'error',
      lastSyncAt: previous.lastSyncAt,
      lastErrorCode: syncError.code,
      ...(env.isDev && syncError.detail ? { lastErrorDetail: syncError.detail } : {}),
    };
    await setSyncState(next);
    devError('sync failed', trigger, syncError.code, syncError.detail);
    return next;
  }
};

export const runSync = (trigger: SyncTrigger): Promise<SyncState> => {
  if (inFlight) return inFlight;
  inFlight = execute(trigger).finally(() => { inFlight = null; });
  return inFlight;
};
