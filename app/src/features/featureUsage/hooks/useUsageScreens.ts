import { useCallback, useEffect, useRef, useState } from 'react';
import { isServiceUnavailable } from '@/services/apiClient';
import { adminUsageService } from '@/services/adminUsage.service';
import { USAGE_ERROR_CODES, usageErrorCode, isUsageReadSuperseded } from '../rules';
import type { UsageQuery, UsageScreensResponse } from '../types';

export interface UsageScreensState {
  /** Resposta do recorte atual; `null` enquanto não há resposta para ele. Nunca persistida. */
  data: UsageScreensResponse | null;
  loading: boolean;
  error: boolean;
  /** 503 `USAGE_METRICS_READ_UNAVAILABLE`. */
  slow: boolean;
  unavailable: boolean;
  reload: () => void;
}

/**
 * Telas abertas (`GET /admin/usage/screens`, P3), pelo canal `screens` da fila de leituras da aba. Resposta de recorte
 * antigo é descartada pelo id do pedido. A aba Telas tem teto próprio de 400 dias nos presets (o da rota), sem herdar o
 * teto nem o reset de período do resumo. Período recusado (400) vira erro comum.
 */
export function useUsageScreens(query: UsageQuery, refreshKey: number): UsageScreensState {
  const queryKey = JSON.stringify(query);
  const [result, setResult] = useState<{ key: string; data: UsageScreensResponse } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [slow, setSlow] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [retry, setRetry] = useState(0);
  const request = useRef(0);

  useEffect(() => {
    const id = ++request.current;
    setLoading(true);
    setError(false);
    setSlow(false);
    adminUsageService.getScreens(JSON.parse(queryKey) as UsageQuery)
      .then((data) => {
        if (id !== request.current) return;
        setResult({ key: queryKey, data });
        setUnavailable(false);
      })
      .catch((err: unknown) => {
        if (id !== request.current || isUsageReadSuperseded(err)) return;
        const isSlow = usageErrorCode(err) === USAGE_ERROR_CODES.readUnavailable;
        setSlow(isSlow);
        setError(!isSlow);
        setUnavailable(!isSlow && isServiceUnavailable(err));
      })
      .finally(() => {
        if (id === request.current) setLoading(false);
      });
  }, [queryKey, refreshKey, retry]);

  const reload = useCallback(() => setRetry((n) => n + 1), []);

  return {
    data: result && result.key === queryKey ? result.data : null,
    loading,
    error,
    slow,
    unavailable,
    reload,
  };
}
