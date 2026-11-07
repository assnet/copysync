/**
 * Persistence layer — `chrome.storage.local`.
 *
 * v3: no auth tokens in storage. Session lives in HttpOnly cookie.
 * Storage holds: settings (theme), syncState, installationId, mlCookieHash, lifecyclePending.
 */

export interface StoredSettings {
  theme: 'system' | 'light' | 'dark';
}

export type SyncStatus = 'idle' | 'syncing' | 'ok' | 'error';

export type SyncErrorCode =
  | 'session_expired'
  | 'forbidden'
  | 'plan_unavailable'
  | 'consent_required'
  | 'ml_not_logged'
  | 'ml_account_mismatch'
  | 'ml_sync_failed'
  | 'api_unreachable'
  | 'api_rejected'
  | 'api_route_missing'
  | 'rate_limited';

export interface SyncState {
  status: SyncStatus;
  startedAt?: string;
  lastSyncAt?: string;
  lastErrorCode?: SyncErrorCode;
  lastErrorDetail?: string;
}

export interface InstallationState {
  installationId: string;
  extensionId: string;
  deviceId?: string;
  linkedAt?: string;
}

const KEYS = {
  settings: 'settings',
  syncState: 'syncState',
  installation: 'installation',
  mlCookieHash: 'mlCookieHash',
  lastSyncEpoch: 'lastSyncEpoch',
  lifecyclePending: 'lifecyclePending',
} as const;

const DEFAULT_SETTINGS: StoredSettings = { theme: 'system' };
const DEFAULT_SYNC: SyncState = { status: 'idle' };

let writeQueue: Promise<unknown> = Promise.resolve();
const enqueue = <T>(task: () => Promise<T>): Promise<T> => {
  const next = writeQueue.then(task, task);
  writeQueue = next.catch(() => undefined);
  return next;
};

const read = async <T>(key: string): Promise<T | undefined> => {
  const result = await chrome.storage.local.get(key);
  return result[key] as T | undefined;
};

// ── Settings ────────────────────────────────────────────────────────────────

export const getSettings = async (): Promise<StoredSettings> => ({
  ...DEFAULT_SETTINGS,
  ...((await read<Partial<StoredSettings>>(KEYS.settings)) ?? {}),
});

export const setSettings = (patch: Partial<StoredSettings>): Promise<StoredSettings> =>
  enqueue(async () => {
    const next = { ...(await getSettings()), ...patch };
    await chrome.storage.local.set({ [KEYS.settings]: next });
    return next;
  });

// ── Sync state ──────────────────────────────────────────────────────────────

const STALE_SYNCING_MS = 5 * 60 * 1000;

export const getSyncState = async (): Promise<SyncState> => {
  const state = (await read<SyncState>(KEYS.syncState)) ?? DEFAULT_SYNC;
  if (state.status !== 'syncing') return state;
  const started = state.startedAt ? Date.parse(state.startedAt) : NaN;
  if (Number.isFinite(started) && Date.now() - started < STALE_SYNCING_MS) return state;
  return { status: 'idle', lastSyncAt: state.lastSyncAt };
};

export const setSyncState = (state: SyncState): Promise<void> =>
  enqueue(() => chrome.storage.local.set({ [KEYS.syncState]: state }));

// ── Installation ────────────────────────────────────────────────────────────

export const getInstallation = (): Promise<InstallationState | undefined> =>
  read<InstallationState>(KEYS.installation);

export const setInstallation = (state: InstallationState): Promise<void> =>
  enqueue(() => chrome.storage.local.set({ [KEYS.installation]: state }));

/**
 * Get-or-create da instalação. Single-flight (promise compartilhada) + fila de escrita:
 * onInstalled, boot, lifecycle e handshake concorrentes recebem o MESMO installationId.
 */
let ensuring: Promise<InstallationState> | null = null;
export const ensureInstallation = (): Promise<InstallationState> => {
  ensuring ??= enqueue(async () => {
    const existing = await read<InstallationState>(KEYS.installation);
    if (existing?.installationId) return existing;
    const created: InstallationState = {
      installationId: crypto.randomUUID(),
      extensionId: chrome.runtime.id,
    };
    await chrome.storage.local.set({ [KEYS.installation]: created });
    return created;
  }).finally(() => { ensuring = null; });
  return ensuring;
};

export const getInstallationId = async (): Promise<string | undefined> =>
  (await getInstallation())?.installationId;

// ── Lifecycle pendente (INSTALL que falhou por rede; reenviado no heartbeat/startup) ──

export interface PendingLifecycleEvent {
  installationId: string;
  type: 'INSTALL' | 'UPDATE' | 'STARTUP';
  version: string;
  channel: string;
  dedupeKey: string;
  extensionId: string;
  previousVersion?: string;
}

export const getPendingLifecycle = (): Promise<PendingLifecycleEvent | undefined> =>
  read<PendingLifecycleEvent>(KEYS.lifecyclePending);

export const setPendingLifecycle = (event: PendingLifecycleEvent): Promise<void> =>
  enqueue(() => chrome.storage.local.set({ [KEYS.lifecyclePending]: event }));

export const clearPendingLifecycle = (): Promise<void> =>
  enqueue(() => chrome.storage.local.remove(KEYS.lifecyclePending));

// ── ML cookie hash (change detection, never actual cookie values) ───────────

export const getMlCookieHash = (): Promise<string | undefined> =>
  read<string>(KEYS.mlCookieHash);

export const setMlCookieHash = (hash: string): Promise<void> =>
  enqueue(() => chrome.storage.local.set({ [KEYS.mlCookieHash]: hash }));

// ── Rate limit epoch ────────────────────────────────────────────────────────

export const getLastSyncEpoch = async (): Promise<number> =>
  (await read<number>(KEYS.lastSyncEpoch)) ?? 0;

export const setLastSyncEpoch = (epoch: number): Promise<void> =>
  enqueue(() => chrome.storage.local.set({ [KEYS.lastSyncEpoch]: epoch }));
