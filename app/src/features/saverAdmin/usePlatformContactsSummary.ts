import { useCallback, useEffect, useRef, useState } from 'react';
import { saverAdminService } from '@/services/saverAdmin.service';
import type { PlatformContactFilters, PlatformContactsSummary } from './types';

export interface PlatformContactsSummaryState {
  data: PlatformContactsSummary | null;
  loading: boolean;
  /** A contagem falhou (a lista não depende dela). */
  failed: boolean;
  reload: () => void;
}

/**
 * Indicadores da base para os filtros atuais. Dado do servidor: nunca persistido. Independente da lista:
 * se falhar (leitura lenta = 503), a tela mostra um aviso discreto e a lista segue. Resposta de filtros
 * antigos é descartada pelo `seq`; o valor anterior fica na tela enquanto o novo carrega.
 */
export function usePlatformContactsSummary(filters: PlatformContactFilters): PlatformContactsSummaryState {
  const [data, setData] = useState<PlatformContactsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const seq = useRef(0);
  const filtersRef = useRef(filters);
  filtersRef.current = filters;
  const key = JSON.stringify(filters);

  const load = useCallback(async () => {
    const mine = ++seq.current;
    setLoading(true);
    setFailed(false);
    try {
      const summary = await saverAdminService.getSummary(filtersRef.current);
      if (mine === seq.current) setData(summary);
    } catch {
      if (mine !== seq.current) return;
      setData(null);
      setFailed(true);
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    return () => { seq.current++; };
  }, [key, load]);

  const reload = useCallback(() => { void load(); }, [load]);
  return { data, loading, failed, reload };
}
