import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';

/**
 * `tab` (sessionStorage): sobrevive a reload e navegação, some ao fechar a aba — padrão para
 * estado de trabalho (rascunho, passo de assistente, filtros, item aberto).
 * `device` (localStorage com dono e validade): rascunho que precisa sobreviver a fechar o navegador
 * — no celular o sistema descarta a aba (e o sessionStorage) ao sair do app. Vale só para o mesmo
 * usuário + tenant, expira (`maxAgeMs`) e some no logout (`clearDevicePersisted`).
 * `browser` (localStorage): sobrevive a fechar o navegador — só para preferências.
 */
export type PersistScope = 'tab' | 'device' | 'browser';

/** Validade padrão do escopo `device`. */
export const DEVICE_DRAFT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export interface PersistOptions<T> {
  scope?: PersistScope;
  /** Mude ao alterar a forma do estado: o valor salvo com outra versão é descartado. */
  version?: number;
  /** Só `device`: idade máxima do salvo (padrão 7 dias). */
  maxAgeMs?: number;
  serialize?: (value: T) => unknown;
  deserialize?: (raw: unknown) => T;
}

const PREFIX = 'ui.';

function storageFor(scope: PersistScope): Storage | null {
  try {
    return scope === 'tab' ? window.sessionStorage : window.localStorage;
  } catch {
    return null;
  }
}

/** Dono do rascunho `device`: usuário + tenant ativos (o rascunho de uma conta nunca abre em outra). */
function currentOwner(): string {
  try {
    const raw = window.localStorage.getItem('authUser');
    const userId = raw ? ((JSON.parse(raw) as { id?: string }).id ?? '') : '';
    return `${userId}:${window.localStorage.getItem('activeTenantId') ?? ''}`;
  } catch {
    return ':';
  }
}

interface Envelope { v?: number; d: unknown; o?: string; t?: number }

function readEnvelope(storage: Storage | null, key: string): Envelope | undefined {
  const raw = storage?.getItem(PREFIX + key);
  return raw == null ? undefined : (JSON.parse(raw) as Envelope);
}

export function readPersisted<T>(key: string, opts: PersistOptions<T> = {}): T | undefined {
  const scope = opts.scope ?? 'tab';
  const storage = storageFor(scope);
  if (!storage) return undefined;
  try {
    let parsed = readEnvelope(storage, key);
    if (scope === 'device') {
      const fresh = parsed && parsed.o === currentOwner() && Date.now() - (parsed.t ?? 0) <= (opts.maxAgeMs ?? DEVICE_DRAFT_MAX_AGE_MS);
      if (parsed && !fresh) {
        storage.removeItem(PREFIX + key);
        parsed = undefined;
      }
      // Rascunho de antes da troca de escopo (mesma aba): aproveita uma vez
      parsed ??= readEnvelope(storageFor('tab'), key);
    }
    if (!parsed) return undefined;
    if ((parsed.v ?? 0) !== (opts.version ?? 0)) return undefined;
    return opts.deserialize ? opts.deserialize(parsed.d) : (parsed.d as T);
  } catch {
    return undefined;
  }
}

export function writePersisted<T>(key: string, value: T, opts: PersistOptions<T> = {}): void {
  const scope = opts.scope ?? 'tab';
  const storage = storageFor(scope);
  if (!storage) return;
  try {
    const d = opts.serialize ? opts.serialize(value) : value;
    const envelope: Envelope = scope === 'device'
      ? { v: opts.version ?? 0, d, o: currentOwner(), t: Date.now() }
      : { v: opts.version ?? 0, d };
    storage.setItem(PREFIX + key, JSON.stringify(envelope));
  } catch {
    // sem espaço ou armazenamento bloqueado: o estado vale só enquanto a tela viver
  }
}

export function clearPersisted(key: string, scope: PersistScope = 'tab'): void {
  try {
    storageFor(scope)?.removeItem(PREFIX + key);
    // `device` pode ter cópia antiga na aba (antes da troca de escopo)
    if (scope === 'device') storageFor('tab')?.removeItem(PREFIX + key);
  } catch {
    // nada a fazer
  }
}

/** Logout: apaga todos os rascunhos `device` (os que têm dono) deste navegador. */
export function clearDevicePersisted(): void {
  const storage = storageFor('device');
  if (!storage) return;
  try {
    const keys: string[] = [];
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i);
      if (k?.startsWith(PREFIX)) keys.push(k);
    }
    for (const k of keys) {
      try {
        if ((JSON.parse(storage.getItem(k) ?? 'null') as Envelope | null)?.o !== undefined) storage.removeItem(k);
      } catch {
        // valor não é envelope: não é nosso
      }
    }
  } catch {
    // nada a fazer
  }
}

/**
 * `useState` que sobrevive a reload (docs/padrao-ui-painel.md, "Persistência contra reload").
 * Devolve também `clear()`: volta ao inicial e apaga o salvo — chame ao concluir o fluxo.
 * Nunca persista dado do servidor nem segredo; só estado de interface.
 */
export function usePersistedState<T>(
  key: string,
  initial: T | (() => T),
  opts: PersistOptions<T> = {},
): [T, Dispatch<SetStateAction<T>>, () => void] {
  const optsRef = useRef(opts);
  optsRef.current = opts;
  const initialRef = useRef(initial);
  // clear() volta ao inicial sem regravar: o efeito pula a próxima escrita
  const skipWriteRef = useRef(false);

  const [state, setState] = useState<T>(() => {
    const saved = readPersisted<T>(key, opts);
    if (saved !== undefined) return saved;
    return typeof initial === 'function' ? (initial as () => T)() : initial;
  });

  useEffect(() => {
    if (skipWriteRef.current) {
      skipWriteRef.current = false;
      return;
    }
    writePersisted(key, state, optsRef.current);
  }, [key, state]);

  const clear = useCallback(() => {
    clearPersisted(key, optsRef.current.scope ?? 'tab');
    skipWriteRef.current = true;
    const init = initialRef.current;
    setState(typeof init === 'function' ? (init as () => T)() : init);
  }, [key]);

  return [state, setState, clear];
}
