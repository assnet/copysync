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

const CREDS_KEY = '__creds__';
const PROVIDER = 'baileys';

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
): Promise<{ state: AuthenticationState; saveCreds: () => Promise<void> }> {
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
  async function persistState(): Promise<void> {
    await authStateRepo.upsert({
      sessionId,
      tenantId,
      provider: PROVIDER,
      statePayload: stateMap,
    });
  }

  // ── saveCreds — called by Baileys when credentials change ──────────────────
  async function saveCreds(): Promise<void> {
    stateMap[CREDS_KEY] = serialize(creds);
    await persistState();
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
            stateMap[key] = serialize(value);
          } else {
            delete stateMap[key];
          }
          dirty = true;
        }
      }
      if (dirty) {
        await persistState();
      }
    },
  };

  return {
    state: { creds, keys },
    saveCreds,
  };
}
