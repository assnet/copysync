import { useCallback, useEffect, useRef, useState } from 'react';
import { isServiceUnavailable } from '@/services/apiClient';
import { adminUsageService } from '@/services/adminUsage.service';
import { USAGE_ERROR_CODES, usageErrorCode, isUsageReadSuperseded, rangeInvalidMaxDays } from '../rules';
import type { UsageFeatureDetail, UsageQuery } from '../types';

export interface UsageDetailState {
  /** Resposta do recorte atual; `null` enquanto não há resposta para ele. Nunca persistida. */
  data: UsageFeatureDetail | null;
  loading: boolean;
  error: boolean;
  /** 503 `USAGE_METRICS_READ_UNAVAILABLE`. */
  slow: boolean;
  unavailable: boolean;
  /** 404 `USAGE_METRICS_FEATURE_NOT_FOUND`: chave fora do catálogo. */
  notFound: boolean;
  reload: () => void;
}

/**
 * Detalhe de um recurso (`GET /admin/usage/features/:key`). Recarrega quando a query, a chave ou o `refreshKey`
 * mudam; resposta de recorte antigo é descartada pelo id do pedido. A leitura passa pela fila do serviço (uma por
 * vez por aba; o duplo efeito do StrictMode reaproveita o pedido em voo). Informa o teto do período (`range.maxDays`).
 * 400 `USAGE_METRICS_RANGE_INVALID` chama `onRangeInvalid`.
 */
export function useUsageDetail(
  featureKey: string,
  query: UsageQuery,
  options: { refreshKey: number; reportMaxDays: (n: number) => void; onRangeInvalid?: (maxDays: number | null) => void },
): UsageDetailState {
  const { refreshKey } = options;
  const queryKey = JSON.stringify(query);
  const [result, setResult] = useState<{ key: string; data: UsageFeatureDetail } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [slow, setSlow] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [retry, setRetry] = useState(0);
  const request = useRef(0);
  const callbacks = useRef(options);
  callbacks.current = options;

  useEffect(() => {
    const id = ++request.current;
    setLoading(true);
    setError(false);
    setSlow(false);
    setNotFound(false);
    adminUsageService.getDetail(featureKey, JSON.parse(queryKey) as UsageQuery)
      .then((data) => {
        if (id !== request.current) return;
        setResult({ key: queryKey, data });
        setUnavailable(false);
        callbacks.current.reportMaxDays(data.range.maxDays);
      })
      .catch((err: unknown) => {
        if (id !== request.current || isUsageReadSuperseded(err)) return;
        const code = usageErrorCode(err);
        if (code === USAGE_ERROR_CODES.rangeInvalid) {
          callbacks.current.onRangeInvalid?.(rangeInvalidMaxDays(err));
          return;
        }
        if (code === USAGE_ERROR_CODES.featureNotFound) {
          setNotFound(true);
          return;
        }
        const isSlow = code === USAGE_ERROR_CODES.readUnavailable;
        setSlow(isSlow);
        setError(!isSlow);
        setUnavailable(!isSlow && isServiceUnavailable(err));
      })
      .finally(() => {
        if (id === request.current) setLoading(false);
      });
  }, [featureKey, queryKey, refreshKey, retry]);

  const reload = useCallback(() => setRetry((n) => n + 1), []);

  return {
    data: result && result.key === queryKey ? result.data : null,
    loading,
    error,
    slow,
    unavailable,
    notFound,
    reload,
  };
}
