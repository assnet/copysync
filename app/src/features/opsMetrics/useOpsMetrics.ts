import { useCallback, useEffect, useRef, useState } from 'react';
import { opsMetricsService } from '@/services/opsMetrics.service';
import { serverNow } from '@/services/serverClock';
import { rangeWindow } from './rules';
import type { OpsBlock, OpsLatest, OpsRange, OpsSeriesResult } from './types';

export const OPS_REFRESH_MS = 60_000;

/** Métricas por bloco (máx. 12 por chamada na API). */
export const OPS_BLOCK_METRICS = {
  servers: ['cpu_pct', 'memory_pct'],
  database: [
    'db_connections', 'db_active', 'db_idle', 'db_idle_in_transaction', 'db_idle_in_transaction_max_age_s',
    'db_cache_hit_pct', 'db_xact_commit', 'db_xact_rollback', 'db_deadlocks', 'db_temp_bytes',
  ],
  workers: ['rss_mb', 'event_loop_p99_ms', 'node_cpu_pct'],
} as const;

type SeriesBlock = Exclude<OpsBlock, 'latest'>;

export interface OpsMetricsState {
  latest: OpsLatest | null;
  series: Record<SeriesBlock, OpsSeriesResult | null>;
  errors: Record<OpsBlock, boolean>;
  /** 1ª carga (ou troca de filtro) em andamento: skeleton. */
  loading: boolean;
  /** Busca em andamento (inclusive refresh): gira o botão. */
  fetching: boolean;
  /** Atualização falhou com dados já na tela. */
  refreshError: boolean;
}

const EMPTY_SERIES: Record<SeriesBlock, OpsSeriesResult | null> = { servers: null, database: null, workers: null };
const NO_ERRORS: Record<OpsBlock, boolean> = { latest: false, servers: false, database: false, workers: false };

/**
 * Valores atuais + séries do período em paralelo, com erro por bloco (um cartão falhar não
 * derruba a aba). Atualização a cada 60 s por `setTimeout` encadeado (nunca acumula): com a aba
 * do navegador oculta não busca; ao voltar, busca na hora se a última tem mais de 60 s.
 * Troca de período busca na hora e reinicia o ciclo; resposta antiga é descartada.
 */
export function useOpsMetrics(range: OpsRange, autoRefresh: boolean) {
  const [state, setState] = useState<OpsMetricsState>({
    latest: null, series: EMPTY_SERIES, errors: NO_ERRORS, loading: true, fetching: false, refreshError: false,
  });
  const reqId = useRef(0);
  const lastFetchAt = useRef(0);
  const hasData = useRef(false);

  const fetchAll = useCallback(async (initial: boolean) => {
    const id = ++reqId.current;
    lastFetchAt.current = Date.now();
    setState((s) => ({ ...s, fetching: true, ...(initial ? { loading: true } : {}) }));
    const window = rangeWindow(range, serverNow());
    const [latest, servers, database, workers] = await Promise.allSettled([
      opsMetricsService.latest(),
      opsMetricsService.series([...OPS_BLOCK_METRICS.servers], window),
      opsMetricsService.series([...OPS_BLOCK_METRICS.database], window),
      opsMetricsService.series([...OPS_BLOCK_METRICS.workers], window),
    ]);
    if (id !== reqId.current) return false;
    const allFailed = [latest, servers, database, workers].every((r) => r.status === 'rejected');
    setState((s) => {
      // Refresh que falhou inteiro com dados na tela: mantém tudo e só sinaliza.
      if (allFailed && hasData.current && !initial) {
        return { ...s, fetching: false, loading: false, refreshError: true };
      }
      const pick = <T,>(r: PromiseSettledResult<T>, prev: T | null): T | null =>
        (r.status === 'fulfilled' ? r.value : initial ? null : prev);
      const next: OpsMetricsState = {
        latest: pick(latest, s.latest),
        series: {
          servers: pick(servers, s.series.servers),
          database: pick(database, s.series.database),
          workers: pick(workers, s.series.workers),
        },
        errors: {
          latest: latest.status === 'rejected',
          servers: servers.status === 'rejected',
          database: database.status === 'rejected',
          workers: workers.status === 'rejected',
        },
        loading: false,
        fetching: false,
        refreshError: false,
      };
      hasData.current = !allFailed;
      return next;
    });
    return !allFailed;
  }, [range]);

  // Troca de período: busca na hora (com skeleton).
  useEffect(() => {
    void fetchAll(true);
  }, [fetchAll]);

  // Ciclo de atualização automática.
  useEffect(() => {
    if (!autoRefresh) return undefined;
    let timer: number | undefined;
    const schedule = (delay: number) => {
      window.clearTimeout(timer);
      timer = window.setTimeout(tick, Math.max(0, delay));
    };
    const tick = () => {
      if (document.visibilityState === 'hidden') return; // retoma no visibilitychange
      void fetchAll(false).finally(() => schedule(OPS_REFRESH_MS));
    };
    const onVisibility = () => {
      if (document.visibilityState !== 'visible') return;
      const elapsed = Date.now() - lastFetchAt.current;
      schedule(elapsed >= OPS_REFRESH_MS ? 0 : OPS_REFRESH_MS - elapsed);
    };
    schedule(OPS_REFRESH_MS - (Date.now() - lastFetchAt.current));
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [autoRefresh, fetchAll]);

  return { ...state, reload: (initial = false) => fetchAll(initial) };
}
