import { useCallback, useEffect, useState } from 'react';
import { isServiceUnavailable } from '@/services/apiClient';
import { adminCostsService } from '@/services/adminCosts.service';
import { infraCostsStrings } from './strings';
import type { InfraCostSummary } from './types';

/**
 * Aba Resumo (COST-07): `GET /admin/costs/summary`. `month` nulo = mês corrente do servidor.
 * A resposta não é persistida (só os filtros, na tela).
 */
export function useCostSummary(month: string | null) {
  const [data, setData] = useState<InfraCostSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /** API fora do ar (deploy); só limpa ao concluir a próxima leitura. */
  const [unavailable, setUnavailable] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await adminCostsService.getSummary(month));
      setUnavailable(false);
    } catch (err) {
      setError(infraCostsStrings.errors.loadFailed);
      setUnavailable(isServiceUnavailable(err));
    } finally {
      setLoading(false);
    }
  }, [month]);

  useEffect(() => {
    void load();
  }, [load]);

  return { data, loading, error, unavailable, reload: load };
}
