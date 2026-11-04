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
import { SessionLeaseHeldError } from '../../../../../shared/errors/internal/SessionErrors';

const CREDS_KEY = '__creds__';
const PROVIDER = 'baileys';
const log = logger.child({ module: 'BaileysAuthStatePersistence' });

/** Alterações ainda não gravadas: chave → valor serializado, ou null = apagar. */
export type DirtyMap = Map<string, unknown | null>;

export interface BaileysAuthStateDeps {
  /** Debounce/retry injetáveis em teste; padrão = env. */
  flushDebounceMs?: number;
  maxRetries?: number;
  retryDelayMs?: number;
  /**
   * CAS perdido (LEASE-06): outro dono gravou o auth state. Chamado uma vez por handle, sem
   * esperar (o adapter derruba o socket com `abortSession`, que espera este handle assentar).
   */
  onVersionConflict?: (sessionId: string) => void | Promise<void>;
}

export interface BaileysAuthStateHandle {
  state: AuthenticationState;
  saveCreds: () => Promise<void>;
  /** Grava agora o que está sujo (desligamento, testes). */
  forceFlush: () => Promise<void>;
  /** Para de escrever para sempre; devolve o pendente não gravado. */
  dispose: () => DirtyMap;
  /** Resolve quando não há mais escrita em voo (nunca rejeita). */
  settled: () => Promise<void>;
  /** CAS perdido neste handle (outro dono gravou): o pendente dele é lixo. */
  conflicted: () => boolean;
}

/**
 * Um handle vivo por sessão. Criar outro para a mesma sessão (reconexão) grava o que o antigo
 * tinha pendente e o descarta; handle descartado nunca mais escreve (um flush atrasado regravaria
 * chaves velhas por cima das novas, ou ressuscitaria credenciais depois do logout).
 * Builds da mesma sessão são serializados (reconexão automática × conexão manual).
 */
const activeHandles = new Map<string, BaileysAuthStateHandle>();
const buildChain = new Map<string, Promise<unknown>>();
/** Pendente que um handle morto não conseguiu gravar (banco fora): o próximo handle da sessão herda. */
const orphanDirty = new Map<string, DirtyMap>();

function stashOrphans(sessionId: string, leftover: DirtyMap): void {
  if (leftover.size === 0) return;
  const merged = orphanDirty.get(sessionId) ?? new Map<string, unknown | null>();
  for (const [k, v] of leftover) merged.set(k, v);
  orphanDirty.set(sessionId, merged);
  log.warn({ sessionId, keys: merged.size }, 'Auth keys pending without a live handle; next handle will persist them');
}

export async function flushAllAuthStates(): Promise<void> {
  const entries = Array.from(activeHandles.entries());
  if (entries.length === 0) return;
  log.info({ count: entries.length }, 'Flushing all pending auth states on shutdown');
  await Promise.allSettled(entries.map(([id, h]) =>
    h.forceFlush().catch((err) => log.error({ err, sessionId: id }, 'Auth state flush failed')),
  ));
}

/**
 * Grava o pendente da sessão e descarta o handle (desconexão: o estado vale, só o handle morre).
 * O que NÃO conseguiu gravar fica guardado para o próximo handle da sessão.
 */
export async function releaseAuthState(sessionId: string): Promise<void> {
  const h = activeHandles.get(sessionId);
  if (!h) return;
  try {
    await h.forceFlush();
  } catch (err) {
    log.error({ err, sessionId }, 'Auth state flush before release failed; carrying pending keys over');
  }
  stashOrphans(sessionId, h.dispose());
}

/**
 * Descarta o handle SEM gravar (logout, credencial revogada, sessão apagada): o pendente é lixo.
 * Espera um build em curso (o handle ainda não estaria no mapa) e a escrita em voo terminarem,
 * para o `clearCredentials` seguinte não ser desfeito por nenhum dos dois.
 */
export async function discardAuthState(sessionId: string): Promise<void> {
  await buildChain.get(sessionId)?.catch(() => undefined);
  orphanDirty.delete(sessionId);
  const h = activeHandles.get(sessionId);
  if (!h) return;
  h.dispose();
  await h.settled();
}

/**
 * Suspende o handle SEM gravar (fence por erro de banco, ninguém provou outro dono): para de
 * escrever e guarda o pendente — inclusive o de uma escrita em voo que falhar — em `orphanDirty`,
 * para o próximo handle da sessão neste processo gravar. CAS perdido: o pendente vai fora.
 */
export async function suspendAuthState(sessionId: string): Promise<void> {
  await buildChain.get(sessionId)?.catch(() => undefined);
  const h = activeHandles.get(sessionId);
  if (!h) return;
  const pending = h.dispose();
  await h.settled();
  // Escrita em voo que falhou devolveu o lote a sujo depois do dispose: é mais antigo que `pending`
  const leftover = h.dispose();
  for (const [k, v] of pending) leftover.set(k, v);
  if (h.conflicted()) return;
  stashOrphans(sessionId, leftover);
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

export function buildBaileysAuthState(
  sessionId: string,
  tenantId: string,
  authStateRepo: ISessionAuthStateRepository,
  deps: BaileysAuthStateDeps = {},
): Promise<BaileysAuthStateHandle> {
  const prev = buildChain.get(sessionId) ?? Promise.resolve();
  const run = prev.then(() => buildHandle(sessionId, tenantId, authStateRepo, deps));
  buildChain.set(sessionId, run.catch(() => undefined));
  return run;
}

async function buildHandle(
  sessionId: string,
  tenantId: string,
  authStateRepo: ISessionAuthStateRepository,
  deps: BaileysAuthStateDeps,
): Promise<BaileysAuthStateHandle> {
  const flushDebounceMs = deps.flushDebounceMs ?? env.BAILEYS_AUTH_FLUSH_DEBOUNCE_MS;
  const maxRetries = deps.maxRetries ?? env.BAILEYS_AUTH_PERSIST_MAX_RETRIES;
  const retryDelayMs = deps.retryDelayMs ?? env.BAILEYS_AUTH_PERSIST_RETRY_DELAY_MS;

  // Reconexão: o handle anterior grava o pendente e morre ANTES de lermos o banco; o que ele não
  // conseguiu gravar entra como pendente deste (e volta a órfão se esta carga falhar)
  await releaseAuthState(sessionId);
  const carried: DirtyMap = orphanDirty.get(sessionId) ?? new Map();
  orphanDirty.delete(sessionId);

  let conflicted = false;
  /** CAS perdido: loga, avisa o dono do socket uma vez; o pendente vai fora (nunca vira órfão). */
  function reportConflict(): void {
    if (conflicted) return;
    conflicted = true;
    log.warn({ sessionId }, 'Auth state version conflict; another owner wrote it — pending keys discarded');
    if (!deps.onVersionConflict) return;
    try {
      void Promise.resolve(deps.onVersionConflict(sessionId)).catch((err) =>
        log.error({ err, sessionId }, 'Auth state version conflict handler failed'));
    } catch (err) {
      log.error({ err, sessionId }, 'Auth state version conflict handler failed');
    }
  }

  // ── Carga: chaves + versão (base do CAS); sessão ainda no blob legado é migrada ─
  const stateMap = new Map<string, StoredValue>();
  /** Versão de `session_auth_states` que este handle viu por último; toda escrita a confere. */
  let version: number | null;
  try {
    const loaded = await authStateRepo.findAllKeysVersioned(sessionId);
    version = loaded.version;
    for (const [key, value] of Object.entries(loaded.keys)) {
      stateMap.set(key, fromDb(value));
    }
    if (stateMap.size === 0) {
      const legacy = await authStateRepo.findBySessionId(sessionId);
      const payload = legacy?.statePayload;
      if (payload && typeof payload === 'object' && Object.keys(payload).length > 0) {
        const upserts = payload as Record<string, unknown>;
        const res = await authStateRepo.writeKeys({
          sessionId, tenantId, provider: PROVIDER, upserts, deletes: [], expectedVersion: version,
        });
        if (!res.ok) {
          reportConflict();
          throw new SessionLeaseHeldError(sessionId);
        }
        version = res.version;
        for (const [key, value] of Object.entries(upserts)) stateMap.set(key, fromDb(value));
        log.info({ sessionId, keys: stateMap.size }, 'Auth state migrated from legacy blob to per-key rows');
      }
    }
  } catch (err) {
    if (!conflicted) stashOrphans(sessionId, carried);
    throw err;
  }
  for (const [key, value] of carried) {
    if (value === null) stateMap.delete(key);
    else stateMap.set(key, fromDb(value));
  }

  // ── Credenciais ───────────────────────────────────────────────────────────────
  const rawCreds = stateMap.get(CREDS_KEY)?.value;
  const creds: AuthenticationCreds = rawCreds
    ? (deserialize(rawCreds) as AuthenticationCreds)
    : initAuthCreds();

  // ── Sujeira por chave e flush ─────────────────────────────────────────────────
  const dirty: DirtyMap = new Map(carried);
  let flushTimer: NodeJS.Timeout | null = null;
  /** Escrita em voo (promessa própria: o timer só dispara, nunca é esperado). */
  let inFlight: Promise<void> | null = null;
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

  /** `false` = CAS perdido (sem retry: re-tentar regravaria por cima do dono novo). */
  async function writeWithRetry(upserts: Record<string, unknown>, deletes: string[]): Promise<boolean> {
    for (let attempt = 1; ; attempt++) {
      try {
        const res = await authStateRepo.writeKeys({
          sessionId, tenantId, provider: PROVIDER, upserts, deletes, expectedVersion: version,
        });
        if (!res.ok) return false;
        version = res.version;
        return true;
      } catch (err) {
        if (attempt >= maxRetries) throw err;
        log.warn({ err, sessionId, attempt, nextAttemptInMs: retryDelayMs }, 'Failed to persist Baileys auth keys; retrying');
        await wait(retryDelayMs);
      }
    }
  }

  /**
   * Grava o que está sujo agora; chave que sujar DURANTE a gravação sai na volta seguinte do
   * laço. Se a gravação falhar de vez, as chaves voltam a sujas (não se perde a alteração).
   * Chamadas concorrentes esperam a mesma escrita.
   */
  function flushState(): Promise<void> {
    if (inFlight) return inFlight;
    if (disposed || dirty.size === 0) return Promise.resolve();
    inFlight = (async () => {
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
          let written: boolean;
          try {
            written = await writeWithRetry(upserts, deletes);
          } catch (err) {
            for (const [key, value] of snapshot) if (!dirty.has(key)) dirty.set(key, value);
            throw err;
          }
          if (!written) {
            dispose(); // pendente vai fora: nada de órfão para o próximo handle
            reportConflict();
            return;
          }
        }
      } finally {
        inFlight = null;
      }
    })();
    return inFlight;
  }

  /**
   * Agenda o flush e NÃO espera por ele: o Baileys chama `keys.set` no meio da descriptografia
   * de cada mensagem, e esperar o debounce (hoje até 10 s) + a gravação travava esse fluxo.
   * Falha final: loga e rearma com backoff (sessão quieta não fica só em memória).
   */
  function schedulePersist(delayMs = flushDebounceMs): void {
    if (disposed || flushTimer) return;
    flushTimer = setTimeout(() => {
      flushTimer = null;
      flushState().catch((err) => {
        log.error({ err, sessionId }, 'Failed to persist Baileys auth keys after retries');
        if (dirty.size > 0) schedulePersist(Math.min(Math.max(retryDelayMs * 5, 1_000), 30_000));
      });
    }, delayMs);
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

  /** Escrita em voo é esperada (ela drena o que sujar); o que sobrar sai em seguida. */
  async function forceFlush(): Promise<void> {
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    // Escrita em voo que falha já devolveu as chaves a sujas: tenta de novo aqui
    if (inFlight) await inFlight.catch(() => undefined);
    await flushState();
  }

  function dispose(): DirtyMap {
    disposed = true;
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    const leftover = new Map(dirty);
    dirty.clear();
    if (activeHandles.get(sessionId) === handle) activeHandles.delete(sessionId);
    return leftover;
  }

  async function settled(): Promise<void> {
    if (inFlight) await inFlight.catch(() => undefined);
  }

  const handle: BaileysAuthStateHandle = {
    state: { creds, keys }, saveCreds, forceFlush, dispose, settled, conflicted: () => conflicted,
  };
  activeHandles.set(sessionId, handle);
  if (dirty.size > 0) schedulePersist();
  return handle;
}
