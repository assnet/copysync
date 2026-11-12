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
  /** Leitura lenta (503 `INFRA_COST_READ_UNAVAILABLE`): estado próprio "tente de novo", sem auto-retry. */
  const [slow, setSlow] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await adminCostsService.getSummary(month));
      setUnavailable(false);
      setSlow(false);
    } catch (err) {
      const isSlow = (err as { code?: unknown } | null)?.code === 'INFRA_COST_READ_UNAVAILABLE';
      setError(infraCostsStrings.errors.loadFailed);
      setSlow(isSlow);
      setUnavailable(!isSlow && isServiceUnavailable(err));
    } finally {
      setLoading(false);
    }
  }, [month]);

  useEffect(() => {
    void load();
  }, [load]);

  return { data, loading, error, unavailable, slow, reload: load };
}
