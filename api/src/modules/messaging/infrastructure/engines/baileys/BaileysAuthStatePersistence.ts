/**
 * BaileysAuthStatePersistence
 *
 * Implements a DB-backed AuthenticationState for Baileys using ISessionAuthStateRepository.
 * Replaces useMultiFileAuthState — no filesystem dependency for critical session credentials.
 *
 * Only this file and BaileysMessagingEngineAdapter are allowed to import from @whiskeysockets/baileys.
 */
import {
  initAuthCreds,
  BufferJSON,
  proto,
  type AuthenticationState,
  type AuthenticationCreds,
  type SignalDataSet,
  type SignalDataTypeMap,
} from '@whiskeysockets/baileys';
import type { ISessionAuthStateRepository } from '../../../../sessions/domain/contracts/ISessionAuthStateRepository';
import { env } from '../../../../../shared/config/env';
import { logger } from '../../../../../shared/logger/logger';

const CREDS_KEY = '__creds__';
const PROVIDER = 'baileys';
const log = logger.child({ module: 'BaileysAuthStatePersistence' });

const activeFlushers = new Map<string, () => Promise<void>>();

export async function flushAllAuthStates(): Promise<void> {
  const entries = Array.from(activeFlushers.entries());
  if (entries.length === 0) return;
  log.info({ count: entries.length }, 'Flushing all pending auth states on shutdown');
  await Promise.allSettled(entries.map(([id, flush]) =>
    flush().catch((err) => log.error({ err, sessionId: id }, 'Auth state flush failed')),
  ));
}

/**
 * Serialize a value to a plain JSON-compatible object using Baileys' BufferJSON replacer.
 * Handles Buffer / Uint8Array roundtripping.
 */
function serialize(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value, BufferJSON.replacer));
}

/**
 * Deserialize a value previously serialized with serialize().
 */
function deserialize(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value), BufferJSON.reviver);
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function areSerializedValuesEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * Build a Baileys-compatible AuthenticationState that persists to the database.
 *
 * The entire state is stored as a single JSON blob per session to avoid
 * N+1 upserts for each signal key type. The statePayload structure:
 *
 *   {
 *     "__creds__": <AuthenticationCreds>,
 *     "pre-key-<id>": <KeyPair>,
 *     "session-<jid>": <Uint8Array>,
 *     ...
 *   }
 */
export async function buildBaileysAuthState(
  sessionId: string,
  tenantId: string,
  authStateRepo: ISessionAuthStateRepository,
): Promise<{ state: AuthenticationState; saveCreds: () => Promise<void>; forceFlush: () => Promise<void>; dispose: () => void }> {
  // ── Load state from DB ───────────────────────────────────────────────────────
  const record = await authStateRepo.findBySessionId(sessionId);

  // The statePayload is a flat map: key → serialized value
  let stateMap: Record<string, unknown> = {};
  if (record?.statePayload && typeof record.statePayload === 'object') {
    stateMap = record.statePayload as Record<string, unknown>;
  }

  // ── Restore or create credentials ───────────────────────────────────────────
  const rawCreds = stateMap[CREDS_KEY];
  const creds: AuthenticationCreds = rawCreds
    ? (deserialize(rawCreds) as AuthenticationCreds)
    : initAuthCreds();

  // ── Helper to persist the whole state map ──────────────────────────────────
  let flushTimer: NodeJS.Timeout | null = null;
  let flushPromise: Promise<void> | null = null;
  let persistInFlight = false;
  let hasPendingPersist = false;

  function setStateValue(key: string, value: unknown): boolean {
    const serializedValue = serialize(value);
    if (areSerializedValuesEqual(stateMap[key], serializedValue)) {
      return false;
    }

    stateMap[key] = serializedValue;
    return true;
  }

  function deleteStateValue(key: string): boolean {
    if (!Object.prototype.hasOwnProperty.call(stateMap, key)) {
      return false;
    }

    delete stateMap[key];
    return true;
  }

  function markStateDirty(): void {
    hasPendingPersist = true;
  }

  async function persistStateWithRetry(statePayload: Record<string, unknown>): Promise<void> {
    for (let attempt = 1; attempt <= env.BAILEYS_AUTH_PERSIST_MAX_RETRIES; attempt++) {
      try {
        await authStateRepo.upsert({
          sessionId,
          tenantId,
          provider: PROVIDER,
          statePayload,
        });
        return;
      } catch (err) {
        if (attempt >= env.BAILEYS_AUTH_PERSIST_MAX_RETRIES) throw err;
        log.warn(
          { err, sessionId, attempt, nextAttemptInMs: env.BAILEYS_AUTH_PERSIST_RETRY_DELAY_MS },
          'Failed to persist Baileys auth state; retrying',
        );
        await wait(env.BAILEYS_AUTH_PERSIST_RETRY_DELAY_MS);
      }
    }
  }

  async function flushState(): Promise<void> {
    if (persistInFlight) {
      return;
    }

    persistInFlight = true;
    try {
      do {
        hasPendingPersist = false;
        await persistStateWithRetry({ ...stateMap });
      } while (hasPendingPersist);
    } finally {
      persistInFlight = false;
      flushPromise = null;
    }
  }

  function schedulePersistState(): Promise<void> {
    if (!flushPromise) {
      flushPromise = new Promise<void>((resolve, reject) => {
        flushTimer = setTimeout(() => {
          flushTimer = null;
          flushState().then(resolve).catch(reject);
        }, env.BAILEYS_AUTH_FLUSH_DEBOUNCE_MS);
      }).catch((err) => {
        log.error({ err, sessionId }, 'Failed to persist Baileys auth state after retries');
      });
    }

    return flushPromise as Promise<void>;
  }

  function scheduleDirtyStatePersist(): Promise<void> {
    markStateDirty();
    return schedulePersistState();
  }

  // ── saveCreds — called by Baileys when credentials change ──────────────────
  async function saveCreds(): Promise<void> {
    if (setStateValue(CREDS_KEY, creds)) {
      await scheduleDirtyStatePersist();
    }
  }

  // ── SignalKeyStore — reads and writes Signal protocol keys ─────────────────
  const keys = {
    async get<T extends keyof SignalDataTypeMap>(
      type: T,
      ids: string[],
    ): Promise<{ [id: string]: SignalDataTypeMap[T] }> {
      const result: { [id: string]: SignalDataTypeMap[T] } = {};
      for (const id of ids) {
        const key = `${type}__${id}`;
        const raw = stateMap[key];
        if (raw !== undefined && raw !== null) {
          let value: SignalDataTypeMap[T] = deserialize(raw) as SignalDataTypeMap[T];
          // Baileys requires AppStateSyncKeyData to be deserialized from proto
          if (type === 'app-state-sync-key' && value) {
            value = proto.Message.AppStateSyncKeyData.fromObject(
              value as object,
            ) as unknown as SignalDataTypeMap[T];
          }
          result[id] = value;
        }
      }
      return result;
    },

    async set(data: SignalDataSet): Promise<void> {
      let dirty = false;
      for (const category in data) {
        const categoryData = data[category as keyof SignalDataTypeMap];
        if (!categoryData) continue;
        for (const id in categoryData) {
          const key = `${category}__${id}`;
          const value = categoryData[id as keyof typeof categoryData];
          if (value !== null && value !== undefined) {
            dirty = setStateValue(key, value) || dirty;
          } else {
            dirty = deleteStateValue(key) || dirty;
          }
        }
      }
      if (dirty) {
        await scheduleDirtyStatePersist();
      }
    },
  };

  async function forceFlush(): Promise<void> {
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    await flushState();
  }

  function dispose(): void {
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    activeFlushers.delete(sessionId);
  }

  activeFlushers.set(sessionId, forceFlush);

  return {
    state: { creds, keys },
    saveCreds,
    forceFlush,
    dispose,
  };
}
