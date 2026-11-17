import { useCallback, useEffect, useRef, useState } from 'react';
import { saverAdminService } from '@/services/saverAdmin.service';
import type { PlatformContactFilters, PlatformContactsSummary } from './types';

export interface PlatformContactsSummaryState {
  /** Última contagem recebida; pode ser dos filtros anteriores enquanto a nova carrega (`current` falso). */
  data: PlatformContactsSummary | null;
  /** Filtros a que `data` responde (define o tipo e a barra ativa da distribuição). */
  filters: PlatformContactFilters | null;
  /** `data` responde aos filtros atuais: só então serve de total para o rodapé da lista. */
  current: boolean;
  loading: boolean;
  /** A contagem falhou (a lista não depende dela). */
  failed: boolean;
  reload: () => void;
}

/**
 * Indicadores da base para os filtros atuais. Dado do servidor: nunca persistido. Independente da lista:
 * se falhar (leitura lenta = 503), a tela mostra um aviso discreto e a lista segue. Resposta de filtros
 * antigos é descartada pelo `seq`. A contagem fica guardada COM os filtros a que responde: enquanto a nova
 * carrega, a tela mostra a anterior inteira e coerente (nunca filtro novo sobre número antigo).
 */
export function usePlatformContactsSummary(filters: PlatformContactFilters): PlatformContactsSummaryState {
  const [result, setResult] = useState<{ key: string; filters: PlatformContactFilters; data: PlatformContactsSummary } | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const seq = useRef(0);
  const filtersRef = useRef(filters);
  filtersRef.current = filters;
  const key = JSON.stringify(filters);

  const load = useCallback(async () => {
    const mine = ++seq.current;
    const asked = filtersRef.current;
    setLoading(true);
    setFailed(false);
    try {
      const data = await saverAdminService.getSummary(asked);
      if (mine === seq.current) setResult({ key: JSON.stringify(asked), filters: asked, data });
    } catch {
      if (mine !== seq.current) return;
      setResult(null);
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
  return {
    data: result?.data ?? null,
    filters: result?.filters ?? null,
    current: result !== null && result.key === key && !loading,
    loading,
    failed,
    reload,
  };
}
