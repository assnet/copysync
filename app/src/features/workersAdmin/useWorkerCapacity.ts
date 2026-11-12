import { useCallback, useEffect, useState } from 'react';
import { isServiceUnavailable } from '@/services/apiClient';
import { adminWorkersService } from '@/services/adminWorkers.service';
import { opsMetricsService } from '@/services/opsMetrics.service';
import { serverNow } from '@/services/serverClock';
import { rangeWindow } from '@/features/opsMetrics/rules';
import type { OpsSeriesResult } from '@/features/opsMetrics/types';
import { workersAdminStrings } from './strings';
import type { WorkerCapacityView } from './types';

/** Métricas da série sessões × capacidade (fonte `sessions`, recurso `cluster`). */
export const CAPACITY_SERIES_METRICS = ['sessions_connected', 'sessions_capacity'] as const;

/**
 * Aba Capacidade (WSCALE-10): capacidade (`GET /admin/workers/capacity`) e série de 7 dias
 * (`GET /admin/ops/metrics/series`) buscadas em paralelo; erro de uma não derruba a outra.
 */
export function useWorkerCapacity() {
  const [data, setData] = useState<WorkerCapacityView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /** Falha por API fora do ar (deploy); só limpa ao concluir a próxima leitura. */
  const [unavailable, setUnavailable] = useState(false);
  const [series, setSeries] = useState<OpsSeriesResult | null>(null);
  const [seriesLoading, setSeriesLoading] = useState(true);
  const [seriesError, setSeriesError] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await adminWorkersService.getCapacity());
      setUnavailable(false);
    } catch (err) {
      setError(workersAdminStrings.capacity.errors.loadFailed);
      setUnavailable(isServiceUnavailable(err));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadSeries = useCallback(async () => {
    setSeriesLoading(true);
    setSeriesError(false);
    try {
      setSeries(await opsMetricsService.series([...CAPACITY_SERIES_METRICS], rangeWindow('7d', serverNow())));
    } catch {
      setSeriesError(true);
    } finally {
      setSeriesLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    void loadSeries();
  }, [load, loadSeries]);

  return { data, loading, error, unavailable, reload: load, series, seriesLoading, seriesError, reloadSeries: loadSeries };
}

