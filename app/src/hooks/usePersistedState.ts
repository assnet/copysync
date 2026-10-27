import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';

/**
 * `tab` (sessionStorage): sobrevive a reload e navegação, some ao fechar a aba — padrão para
 * estado de trabalho (rascunho, passo de assistente, filtros, item aberto).
 * `browser` (localStorage): sobrevive a fechar o navegador — só para preferências.
 */
export type PersistScope = 'tab' | 'browser';

export interface PersistOptions<T> {
  scope?: PersistScope;
  /** Mude ao alterar a forma do estado: o valor salvo com outra versão é descartado. */
  version?: number;
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

export function readPersisted<T>(key: string, opts: PersistOptions<T> = {}): T | undefined {
  const storage = storageFor(opts.scope ?? 'tab');
  if (!storage) return undefined;
  try {
    const raw = storage.getItem(PREFIX + key);
    if (raw == null) return undefined;
    const parsed = JSON.parse(raw) as { v?: number; d: unknown };
    if ((parsed.v ?? 0) !== (opts.version ?? 0)) return undefined;
    return opts.deserialize ? opts.deserialize(parsed.d) : (parsed.d as T);
  } catch {
    return undefined;
  }
}

export function writePersisted<T>(key: string, value: T, opts: PersistOptions<T> = {}): void {
  const storage = storageFor(opts.scope ?? 'tab');
  if (!storage) return;
  try {
    const d = opts.serialize ? opts.serialize(value) : value;
    storage.setItem(PREFIX + key, JSON.stringify({ v: opts.version ?? 0, d }));
  } catch {
    // sem espaço ou armazenamento bloqueado: o estado vale só enquanto a tela viver
  }
}

export function clearPersisted(key: string, scope: PersistScope = 'tab'): void {
  try {
    storageFor(scope)?.removeItem(PREFIX + key);
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

  const [state, setState] = useState<T>(() => {
    const saved = readPersisted<T>(key, opts);
    if (saved !== undefined) return saved;
    return typeof initial === 'function' ? (initial as () => T)() : initial;
  });

  useEffect(() => {
    writePersisted(key, state, optsRef.current);
  }, [key, state]);

  const clear = useCallback(() => {
    clearPersisted(key, optsRef.current.scope ?? 'tab');
    const init = initialRef.current;
    setState(typeof init === 'function' ? (init as () => T)() : init);
  }, [key]);

  return [state, setState, clear];
}
