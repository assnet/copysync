import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';

/** Código do erro rejeitado pelo `apiClient` (`err.code`), ou null. */
export function huntErrorCode(err: unknown): string | null {
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : null;
}

export interface HuntResource<T> {
  data: T | null;
  loading: boolean;
  /** Código da API da última falha de carga (`'UNKNOWN'` sem código); null = ok. */
  errorCode: string | null;
  reload: () => Promise<void>;
  /** Troca o dado local após uma mutação (sem recarregar). */
  setData: Dispatch<SetStateAction<T | null>>;
}

/**
 * Carga simples de dado do servidor (recarregado, nunca persistido). `key` null = não carrega.
 * Resposta antiga (chave trocada no meio) é descartada.
 */
export function useHuntResource<T>(key: string | null, load: () => Promise<T>): HuntResource<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(key !== null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const loadRef = useRef(load);
  loadRef.current = load;
  const seq = useRef(0);

  const reload = useCallback(async () => {
    if (key === null) return;
    const mine = ++seq.current;
    setLoading(true);
    setErrorCode(null);
    try {
      const value = await loadRef.current();
      if (mine === seq.current) setData(value);
    } catch (err) {
      if (mine === seq.current) setErrorCode(huntErrorCode(err) ?? 'UNKNOWN');
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }, [key]);

  useEffect(() => {
    setData(null);
    void reload();
    return () => { seq.current++; };
  }, [reload]);

  return { data, loading, errorCode, reload, setData };
}
