/**
 * Persistence layer — `chrome.storage.local`.
 *
 * v3: no auth tokens in storage. Session lives in HttpOnly cookie.
 * Storage holds: settings (theme), syncState, installationId, mlCookieHash, lifecyclePending.
 * Estado de sync é POR MARKETPLACE: as chaves do ML ficam com o nome antigo (base instalada);
 * as da Shein ganham prefixo. Sync de um nunca lê/grava o estado do outro.
 */
import type { MarketplaceKey } from '../config/env.js';

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
  | 'shein_not_logged'
  | 'shein_permission_missing'
  | 'shein_sync_failed'
  | 'risk_not_accepted'
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
  pendingAccess: 'pendingAccess',
} as const;

/** Chaves de sync por marketplace. ML mantém os nomes da v3.3 (sem migração). */
const SYNC_KEYS: Record<MarketplaceKey, { syncState: string; cookieHash: string; lastSyncEpoch: string; autoSyncPaused: string }> = {
  ml: { syncState: KEYS.syncState, cookieHash: KEYS.mlCookieHash, lastSyncEpoch: KEYS.lastSyncEpoch, autoSyncPaused: 'mlAutoSyncPaused' },
  shein: { syncState: 'sheinSyncState', cookieHash: 'sheinCookieHash', lastSyncEpoch: 'sheinLastSyncEpoch', autoSyncPaused: 'sheinAutoSyncPaused' },
};

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

export const getSyncState = async (marketplace: MarketplaceKey): Promise<SyncState> => {
  const state = (await read<SyncState>(SYNC_KEYS[marketplace].syncState)) ?? DEFAULT_SYNC;
  if (state.status !== 'syncing') return state;
  const started = state.startedAt ? Date.parse(state.startedAt) : NaN;
  if (Number.isFinite(started) && Date.now() - started < STALE_SYNCING_MS) return state;
  return { status: 'idle', lastSyncAt: state.lastSyncAt };
};

export const setSyncState = (marketplace: MarketplaceKey, state: SyncState): Promise<void> =>
  enqueue(() => chrome.storage.local.set({ [SYNC_KEYS[marketplace].syncState]: state }));

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

// ── Cookie hash (change detection, never actual cookie values) ──────────────

export const getCookieHash = (marketplace: MarketplaceKey): Promise<string | undefined> =>
  read<string>(SYNC_KEYS[marketplace].cookieHash);

export const setCookieHash = (marketplace: MarketplaceKey, hash: string): Promise<void> =>
  enqueue(() => chrome.storage.local.set({ [SYNC_KEYS[marketplace].cookieHash]: hash }));

// ── Rate limit epoch ────────────────────────────────────────────────────────

export const getLastSyncEpoch = async (marketplace: MarketplaceKey): Promise<number> =>
  (await read<number>(SYNC_KEYS[marketplace].lastSyncEpoch)) ?? 0;

export const setLastSyncEpoch = (marketplace: MarketplaceKey, epoch: number): Promise<void> =>
  enqueue(() => chrome.storage.local.set({ [SYNC_KEYS[marketplace].lastSyncEpoch]: epoch }));

/** Esquece hash e rate limit do marketplace: o próximo sync envia de novo (sem valor de cookie guardado). */
export const clearCookieTracking = (marketplace: MarketplaceKey): Promise<void> =>
  enqueue(() => chrome.storage.local.remove([SYNC_KEYS[marketplace].cookieHash, SYNC_KEYS[marketplace].lastSyncEpoch]));

// ── Sync automático pausado (servidor recusou: só ação manual reativa) ──────

export const isAutoSyncPaused = async (marketplace: MarketplaceKey): Promise<boolean> =>
  (await read<boolean>(SYNC_KEYS[marketplace].autoSyncPaused)) === true;

export const setAutoSyncPaused = (marketplace: MarketplaceKey, paused: boolean): Promise<void> =>
  enqueue(() => paused
    ? chrome.storage.local.set({ [SYNC_KEYS[marketplace].autoSyncPaused]: true })
    : chrome.storage.local.remove(SYNC_KEYS[marketplace].autoSyncPaused));

// ── Pedido de permissão de host pendente (`shein.requestAccess` → clique no ícone) ──

export interface PendingAccess {
  marketplace: MarketplaceKey;
  /** Epoch ms; depois disso o clique no ícone volta a só focar o painel. */
  until: number;
}

/**
 * Espelho em memória: `permissions.request` só vale no gesto, então o clique no ícone decide
 * SÍNCRONO (`peekPendingAccess`), sem `await` antes do pedido. `undefined` = ainda não lido.
 */
let pendingMemo: PendingAccess | null | undefined;
/** Sobe a cada set/clear: leitura que começou antes não sobrescreve o espelho com valor velho. */
let pendingGeneration = 0;

const valid = (pending: PendingAccess | null | undefined): PendingAccess | null =>
  pending && pending.until > Date.now() ? pending : null;

export const getPendingAccess = async (): Promise<PendingAccess | null> => {
  const generation = pendingGeneration;
  const stored = (await read<PendingAccess>(KEYS.pendingAccess)) ?? null;
  // set/clear durante a leitura: o espelho já tem o valor novo.
  if (generation !== pendingGeneration) return valid(pendingMemo);
  // Espelho já carregado: ele é a verdade (set/clear gravam nele na hora; a escrita no storage é
  // enfileirada e pode ainda não ter rodado). Storage só manda no cold start (`undefined`).
  if (pendingMemo !== undefined) return valid(pendingMemo);
  // Vencida: sai do storage na leitura (não fica lixo esperando um clique que não vem).
  if (stored && !valid(stored)) {
    await clearPendingAccess();
    return null;
  }
  pendingMemo = stored;
  return stored;
};

/** Leitura síncrona do espelho: `undefined` se o worker acabou de subir e ainda não leu. */
export const peekPendingAccess = (): PendingAccess | null | undefined =>
  pendingMemo === undefined ? undefined : valid(pendingMemo);

export const setPendingAccess = (pending: PendingAccess): Promise<void> => {
  pendingGeneration += 1;
  pendingMemo = pending;
  return enqueue(() => chrome.storage.local.set({ [KEYS.pendingAccess]: pending }));
};

export const clearPendingAccess = (): Promise<void> => {
  pendingGeneration += 1;
  pendingMemo = null;
  return enqueue(() => chrome.storage.local.remove(KEYS.pendingAccess));
};
