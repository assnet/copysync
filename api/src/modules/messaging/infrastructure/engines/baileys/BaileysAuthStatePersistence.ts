/**
 * BaileysAuthStatePersistence
 *
 * AuthenticationState do Baileys gravado no banco via ISessionAuthStateRepository, UMA LINHA POR
 * CHAVE (`__creds__`, `pre-key__<id>`, `session__<jid>`, `app-state-sync-version__<name>`…), como
 * o `useMultiFileAuthState` da própria lib faz com um arquivo por chave.
 *
 * Leituras saem da memória (mapa carregado no boot da sessão). Escritas marcam a chave como suja e
 * o flush (debounce `BAILEYS_AUTH_FLUSH_DEBOUNCE_MS`) grava SÓ as chaves alteradas/removidas.
 * O modelo antigo (blob único em `session_auth_states.statePayload`) regravava 3–6 MB a cada
 * chave; ver docs/sessoes-auth-state.md. Sessão ainda no blob é migrada no boot, sem zerar o blob
 * (janela de rollback).
 *
 * Só este arquivo e o BaileysMessagingEngineAdapter importam de @whiskeysockets/baileys.
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

/**
 * Um handle vivo por sessão. Criar outro para a mesma sessão (reconexão) grava o que o antigo
 * tinha pendente e o descarta; handle descartado nunca mais escreve (um flush atrasado regravaria
 * chaves velhas por cima das novas, ou ressuscitaria credenciais depois do logout).
 */
const activeHandles = new Map<string, BaileysAuthStateHandle>();

export async function flushAllAuthStates(): Promise<void> {
  const entries = Array.from(activeHandles.entries());
  if (entries.length === 0) return;
  log.info({ count: entries.length }, 'Flushing all pending auth states on shutdown');
  await Promise.allSettled(entries.map(([id, h]) =>
    h.forceFlush().catch((err) => log.error({ err, sessionId: id }, 'Auth state flush failed')),
  ));
}

/** Grava o pendente da sessão e descarta o handle (desconexão: o estado vale, só o handle morre). */
export async function releaseAuthState(sessionId: string): Promise<void> {
  const h = activeHandles.get(sessionId);
  if (!h) return;
  try {
    await h.forceFlush();
  } catch (err) {
    log.error({ err, sessionId }, 'Auth state flush before release failed');
  }
  h.dispose();
}

/** Descarta o handle SEM gravar (logout, credencial revogada, sessão apagada): o pendente é lixo. */
export function discardAuthState(sessionId: string): void {
  activeHandles.get(sessionId)?.dispose();
}

/** Texto canônico (chaves ordenadas) para comparar valores: o jsonb do Postgres reordena as chaves. */
function stableText(value: unknown): string {
  return JSON.stringify(value, (_k, v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, (v as Record<string, unknown>)[k]]))
      : v,
  );
}

/** Valor guardado em memória: o JSON serializado (BufferJSON) e o texto canônico para comparar. */
interface StoredValue {
  text: string;
  value: unknown;
}

/** Serializa uma vez por `set` (chaves de MB pesam no event loop) e guarda o texto para comparar. */
function toStored(value: unknown): StoredValue {
  const parsed = JSON.parse(JSON.stringify(value, BufferJSON.replacer));
  return { text: stableText(parsed), value: parsed };
}

function fromDb(value: unknown): StoredValue {
  return { text: stableText(value), value };
}

function deserialize(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value), BufferJSON.reviver);
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface BaileysAuthStateDeps {
  /** Debounce/retry injetáveis em teste; padrão = env. */
  flushDebounceMs?: number;
  maxRetries?: number;
  retryDelayMs?: number;
}

export interface BaileysAuthStateHandle {
  state: AuthenticationState;
  saveCreds: () => Promise<void>;
  forceFlush: () => Promise<void>;
  dispose: () => void;
}

export async function buildBaileysAuthState(
  sessionId: string,
  tenantId: string,
  authStateRepo: ISessionAuthStateRepository,
  deps: BaileysAuthStateDeps = {},
): Promise<BaileysAuthStateHandle> {
  const flushDebounceMs = deps.flushDebounceMs ?? env.BAILEYS_AUTH_FLUSH_DEBOUNCE_MS;
  const maxRetries = deps.maxRetries ?? env.BAILEYS_AUTH_PERSIST_MAX_RETRIES;
  const retryDelayMs = deps.retryDelayMs ?? env.BAILEYS_AUTH_PERSIST_RETRY_DELAY_MS;

  // Reconexão: o handle anterior grava o pendente e morre ANTES de lermos o banco
  await releaseAuthState(sessionId);

  // ── Carga: chaves da tabela nova; sessão ainda no blob legado é migrada ───────
  const stateMap = new Map<string, StoredValue>();
  for (const [key, value] of Object.entries(await authStateRepo.findAllKeys(sessionId))) {
    stateMap.set(key, fromDb(value));
  }
  if (stateMap.size === 0) {
    const legacy = await authStateRepo.findBySessionId(sessionId);
    const payload = legacy?.statePayload;
    if (payload && typeof payload === 'object' && Object.keys(payload).length > 0) {
      const upserts = payload as Record<string, unknown>;
      await authStateRepo.writeKeys({ sessionId, tenantId, provider: PROVIDER, upserts, deletes: [] });
      for (const [key, value] of Object.entries(upserts)) stateMap.set(key, fromDb(value));
      log.info({ sessionId, keys: stateMap.size }, 'Auth state migrated from legacy blob to per-key rows');
    }
  }

  // ── Credenciais ───────────────────────────────────────────────────────────────
  const rawCreds = stateMap.get(CREDS_KEY)?.value;
  const creds: AuthenticationCreds = rawCreds
    ? (deserialize(rawCreds) as AuthenticationCreds)
    : initAuthCreds();

  // ── Sujeira por chave e flush ─────────────────────────────────────────────────
  /** chave → valor novo, ou null = apagar. Só isto vai ao banco no próximo flush. */
  const dirty = new Map<string, unknown | null>();
  let flushTimer: NodeJS.Timeout | null = null;
  let flushPromise: Promise<void> | null = null;
  let persistInFlight = false;
  let disposed = false;

  function setStateValue(key: string, value: unknown): boolean {
    const next = toStored(value);
    if (stateMap.get(key)?.text === next.text) return false;
    stateMap.set(key, next);
    dirty.set(key, next.value);
    return true;
  }

  function deleteStateValue(key: string): boolean {
    if (!stateMap.delete(key)) return false;
    dirty.set(key, null);
    return true;
  }

  async function writeWithRetry(upserts: Record<string, unknown>, deletes: string[]): Promise<void> {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        await authStateRepo.writeKeys({ sessionId, tenantId, provider: PROVIDER, upserts, deletes });
        return;
      } catch (err) {
        if (attempt >= maxRetries) throw err;
        log.warn({ err, sessionId, attempt, nextAttemptInMs: retryDelayMs }, 'Failed to persist Baileys auth keys; retrying');
        await wait(retryDelayMs);
      }
    }
  }

  /**
   * Grava o que está sujo agora; chave que sujar DURANTE a gravação fica para a volta seguinte do
   * laço. Se a gravação falhar de vez, as chaves voltam a sujas (não se perde a alteração).
   */
  async function flushState(): Promise<void> {
    if (persistInFlight || disposed) return;
    persistInFlight = true;
    try {
      while (dirty.size > 0 && !disposed) {
        const snapshot = new Map(dirty);
        dirty.clear();
        const upserts: Record<string, unknown> = {};
        const deletes: string[] = [];
        for (const [key, value] of snapshot) {
          if (value === null) deletes.push(key);
          else upserts[key] = value;
        }
        try {
          await writeWithRetry(upserts, deletes);
        } catch (err) {
          for (const [key, value] of snapshot) if (!dirty.has(key)) dirty.set(key, value);
          throw err;
        }
      }
    } finally {
      persistInFlight = false;
      flushPromise = null;
    }
  }

  /**
   * Agenda o flush e NÃO espera por ele: o Baileys chama `keys.set` no meio da descriptografia
   * de cada mensagem, e esperar o debounce (hoje até 10 s) + a gravação travava esse fluxo.
   * Erro de gravação é logado e as chaves ficam sujas para o próximo flush.
   */
  function schedulePersist(delayMs = flushDebounceMs): void {
    if (disposed || flushPromise) return;
    flushPromise = new Promise<void>((resolve, reject) => {
      flushTimer = setTimeout(() => {
        flushTimer = null;
        flushState().then(resolve).catch(reject);
      }, delayMs);
    }).catch((err) => {
      log.error({ err, sessionId }, 'Failed to persist Baileys auth keys after retries');
      // Rearma: sessão quieta não pode ficar com chaves só em memória até o próximo set
      if (dirty.size > 0) schedulePersist(Math.min(Math.max(retryDelayMs * 5, 1_000), 30_000));
    });
  }

  // ── saveCreds — chamado pelo Baileys quando as credenciais mudam ──────────────
  async function saveCreds(): Promise<void> {
    if (setStateValue(CREDS_KEY, creds)) schedulePersist();
  }

  // ── SignalKeyStore ────────────────────────────────────────────────────────────
  const keys = {
    async get<T extends keyof SignalDataTypeMap>(type: T, ids: string[]): Promise<{ [id: string]: SignalDataTypeMap[T] }> {
      const result: { [id: string]: SignalDataTypeMap[T] } = {};
      for (const id of ids) {
        const raw = stateMap.get(`${type}__${id}`)?.value;
        if (raw !== undefined && raw !== null) {
          let value: SignalDataTypeMap[T] = deserialize(raw) as SignalDataTypeMap[T];
          // Baileys exige AppStateSyncKeyData como proto
          if (type === 'app-state-sync-key' && value) {
            value = proto.Message.AppStateSyncKeyData.fromObject(value as object) as unknown as SignalDataTypeMap[T];
          }
          result[id] = value;
        }
      }
      return result;
    },

    async set(data: SignalDataSet): Promise<void> {
      let changed = false;
      for (const category in data) {
        const categoryData = data[category as keyof SignalDataTypeMap];
        if (!categoryData) continue;
        for (const id in categoryData) {
          const key = `${category}__${id}`;
          const value = categoryData[id as keyof typeof categoryData];
          changed = (value !== null && value !== undefined ? setStateValue(key, value) : deleteStateValue(key)) || changed;
        }
      }
      if (changed) schedulePersist();
    },
  };

  /** Grava agora o que está sujo (desligamento, testes). Flush em voo: espera-o (ele drena o que sujar). */
  async function forceFlush(): Promise<void> {
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    if (persistInFlight && flushPromise) {
      await flushPromise;
      if (dirty.size === 0) return;
    }
    flushPromise = null;
    await flushState();
  }

  function dispose(): void {
    disposed = true;
    dirty.clear();
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    if (activeHandles.get(sessionId) === handle) activeHandles.delete(sessionId);
  }

  const handle: BaileysAuthStateHandle = { state: { creds, keys }, saveCreds, forceFlush, dispose };
  activeHandles.set(sessionId, handle);
  return handle;
}
