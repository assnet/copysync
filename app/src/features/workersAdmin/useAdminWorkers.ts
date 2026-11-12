import { useCallback, useEffect, useRef, useState } from 'react';
import { isServiceUnavailable } from '@/services/apiClient';
import { adminWorkersService } from '@/services/adminWorkers.service';
import { workersAdminStrings as s } from './strings';
import type { WorkerOccupancyList } from './types';

export const WORKERS_REFRESH_MS = 20_000;

/**
 * Ocupação dos workers com atualização a cada 20 s (pulada com a aba oculta).
 * Falha na atualização mantém os últimos dados e sinaliza `refreshError`; falha na 1ª carga vira `loadError`.
 */
export function useAdminWorkers() {
  const [data, setData] = useState<WorkerOccupancyList | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshError, setRefreshError] = useState(false);
  /** 1ª carga falhou por API fora do ar (deploy); só limpa ao concluir uma leitura. */
  const [loadUnavailable, setLoadUnavailable] = useState(false);
  /** Espelho para o tick: enquanto indisponível, quem tenta de novo é o `ServiceUpdatingState`. */
  const unavailableRef = useRef(false);
  const markUnavailable = useCallback((v: boolean) => {
    unavailableRef.current = v;
    setLoadUnavailable(v);
  }, []);

  const fetchOnce = useCallback(async (initial: boolean) => {
    if (initial) {
      setLoading(true);
      setLoadError(null);
    }
    try {
      setData(await adminWorkersService.list());
      setRefreshError(false);
      setLoadError(null);
      markUnavailable(false);
    } catch (err) {
      if (initial) {
        setLoadError(s.errors.generic);
        markUnavailable(isServiceUnavailable(err));
      }
      else setRefreshError(true);
    } finally {
      if (initial) setLoading(false);
    }
  }, [markUnavailable]);

  useEffect(() => {
    void fetchOnce(true);
    const id = window.setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      if (unavailableRef.current) return; // sem 2º laço de retry durante o deploy
      void fetchOnce(false);
    }, WORKERS_REFRESH_MS);
    return () => window.clearInterval(id);
  }, [fetchOnce]);

  return { data, loading, loadError, loadUnavailable, refreshError, reload: () => fetchOnce(true) };
}
