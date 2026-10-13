import {
  STORAGE_KEYS,
  type StoredAuth,
  type StoredSettings,
  type SyncState,
} from '../contract/messages.js';

/**
 * Persistência em `chrome.storage.local`. Único módulo que conhece as chaves;
 * o resto do background lê/grava por estas funções.
 */
const DEFAULT_SETTINGS: StoredSettings = { theme: 'system' };
const DEFAULT_SYNC_STATE: SyncState = { status: 'idle' };

/**
 * Fila de escritas: `chrome.storage.local` não tem transação e o popup dispara
 * gravações paralelas (tema + etiqueta). Serializar evita read-modify-write
 * perdido. Leituras não entram na fila.
 */
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

export const getAuth = async (): Promise<StoredAuth | null> =>
  (await read<StoredAuth>(STORAGE_KEYS.auth)) ?? null;

export const setAuth = (auth: StoredAuth): Promise<void> =>
  enqueue(() => chrome.storage.local.set({ [STORAGE_KEYS.auth]: auth }));

export const clearAuth = (): Promise<void> => enqueue(() => chrome.storage.local.remove(STORAGE_KEYS.auth));

/**
 * Grava um access token renovado SEM ressuscitar sessão: só aplica se a auth
 * atual ainda existir e tiver o mesmo refresh token (logout/troca de tenant
 * durante a chamada vencem). Devolve a auth gravada ou `null`.
 */
export const applyRenewedAccessToken = (refreshToken: string, accessToken: string): Promise<StoredAuth | null> =>
  enqueue(async () => {
    const current = await getAuth();
    if (!current || current.refreshToken !== refreshToken) return null;
    const next = { ...current, accessToken };
    await chrome.storage.local.set({ [STORAGE_KEYS.auth]: next });
    return next;
  });

/** Troca o tenant ativo; só aceita id presente na lista devolvida no login. */
export const selectTenant = (tenantId: string): Promise<StoredAuth | null> =>
  enqueue(async () => {
    const auth = await getAuth();
    if (!auth || !auth.tenants.some((t) => t.id === tenantId)) return null;
    const next = { ...auth, tenantId };
    await chrome.storage.local.set({ [STORAGE_KEYS.auth]: next });
    return next;
  });

export const getSettings = async (): Promise<StoredSettings> => ({
  ...DEFAULT_SETTINGS,
  ...((await read<Partial<StoredSettings>>(STORAGE_KEYS.settings)) ?? {}),
});

export const setSettings = (patch: Partial<StoredSettings>): Promise<StoredSettings> =>
  enqueue(async () => {
    const next = { ...(await getSettings()), ...patch };
    await chrome.storage.local.set({ [STORAGE_KEYS.settings]: next });
    return next;
  });

/** `syncing` mais velho que isto é um service worker que morreu no meio: vira `idle`. */
const STALE_SYNCING_MS = 5 * 60 * 1000;

export const getSyncState = async (): Promise<SyncState> => {
  const state = (await read<SyncState>(STORAGE_KEYS.syncState)) ?? DEFAULT_SYNC_STATE;
  if (state.status !== 'syncing') return state;
  const started = state.startedAt ? Date.parse(state.startedAt) : NaN;
  if (Number.isFinite(started) && Date.now() - started < STALE_SYNCING_MS) return state;
  return { status: 'idle', lastSyncAt: state.lastSyncAt };
};

export const setSyncState = (state: SyncState): Promise<void> =>
  enqueue(() => chrome.storage.local.set({ [STORAGE_KEYS.syncState]: state }));
