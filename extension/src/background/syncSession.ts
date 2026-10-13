import { env } from '../config/env.js';
import type { SyncState } from '../contract/messages.js';
import { devError, devLog } from '../core/devLog.js';
import { syncAffiliateSession } from './apiClient.js';
import { getAuth, getSettings, getSyncState, setSyncState } from './authStore.js';
import { SyncError, toSyncError } from './errors.js';
import { captureSession } from './marketplaceSession.js';

export type SyncTrigger = 'alarm' | 'manual';

/** Mutex simples: alarme e clique manual não podem rodar ao mesmo tempo. */
let inFlight: Promise<SyncState> | null = null;

const execute = async (trigger: SyncTrigger): Promise<SyncState> => {
  const previous = await getSyncState();
  await setSyncState({ ...previous, status: 'syncing', startedAt: new Date().toISOString() });
  devLog('sync start', trigger);

  try {
    const auth = await getAuth();
    if (!auth) throw new SyncError('not_authenticated');

    const [captured, settings] = await Promise.all([captureSession(), getSettings()]);
    const affiliateTag = settings.affiliateTag?.trim();

    await syncAffiliateSession(auth, {
      sessionToken: captured.sessionToken,
      csrfToken: captured.csrfToken,
      ...(affiliateTag ? { affiliateTag } : {}),
      capturedAt: new Date().toISOString(),
    });

    const next: SyncState = { status: 'ok', lastSyncAt: new Date().toISOString() };
    await setSyncState(next);
    devLog('sync ok', trigger);
    return next;
  } catch (error) {
    const syncError = toSyncError(error, 'api_rejected');
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
  inFlight = execute(trigger).finally(() => {
    inFlight = null;
  });
  return inFlight;
};
