import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { describeSaverError, type SaverError } from '../errors';

export interface SaverResource<T> {
  data: T | null;
  loading: boolean;
  /** Última falha de carga já traduzida; null = ok. */
  error: SaverError | null;
  reload: () => Promise<void>;
  /** Troca o dado local após uma mutação (sem recarregar). */
  setData: Dispatch<SetStateAction<T | null>>;
}

/**
 * Carga de dado do servidor (recarregado pelo id, nunca persistido). `key` null = não carrega;
 * resposta de uma chave antiga é descartada.
 */
export function useSaverResource<T>(key: string | null, load: () => Promise<T>): SaverResource<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(key !== null);
  const [error, setError] = useState<SaverError | null>(null);
  const loadRef = useRef(load);
  loadRef.current = load;
  const seq = useRef(0);

  const reload = useCallback(async () => {
    if (key === null) {
      setLoading(false);
      return;
    }
    const mine = ++seq.current;
    setLoading(true);
    setError(null);
    try {
      const value = await loadRef.current();
      if (mine === seq.current) setData(value);
    } catch (err) {
      if (mine === seq.current) setError(describeSaverError(err));
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }, [key]);

  useEffect(() => {
    setData(null);
    void reload();
    return () => { seq.current++; };
  }, [reload]);

  return { data, loading, error, reload, setData };
}
