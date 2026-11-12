import { useCallback, useEffect, useState } from 'react';
import { isServiceUnavailable } from '@/services/apiClient';
import { adminCostsService } from '@/services/adminCosts.service';
import { infraCostsStrings } from './strings';
import type { InfraCostHistory } from './types';

/** Aba Histórico (COST-15): `GET /admin/costs/history` (só meses fechados). Resposta não persistida. */
export function useCostHistory() {
  const [data, setData] = useState<InfraCostHistory | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await adminCostsService.getHistory());
      setUnavailable(false);
    } catch (err) {
      setError(infraCostsStrings.errors.loadFailed);
      setUnavailable(isServiceUnavailable(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return { data, loading, error, unavailable, reload: load };
}
