import { useCallback, useEffect, useRef, useState } from 'react';
import { isServiceUnavailable } from '@/services/apiClient';
import { adminUsageService } from '@/services/adminUsage.service';
import { USAGE_ERROR_CODES, usageErrorCode } from '../rules';
import type { UsageFeatureDetail, UsageQuery } from '../types';

/**
 * Fila de leituras do detalhe: cada leitura só começa quando a anterior terminou (sucesso ou erro). O `apiClient`
 * não cancela pedido e a API recusa a segunda leitura de uso simultânea (503), então detalhe, lista de contas e
 * "Carregar mais" passam todos por aqui — a tela nunca tem duas leituras de uso em voo.
 */
export type UsageReadQueue = <T>(read: () => Promise<T>) => Promise<T>;

export function useUsageReadQueue(): UsageReadQueue {
  const tail = useRef<Promise<unknown>>(Promise.resolve());
  return useCallback(<T,>(read: () => Promise<T>) => {
    const next = tail.current.then(read, read);
    tail.current = next.catch(() => undefined);
    return next;
  }, []);
}

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
 * mudam; resposta de recorte antigo é descartada pelo id do pedido. Informa o teto do período (`range.maxDays`).
 * 400 `USAGE_METRICS_RANGE_INVALID` chama `onRangeInvalid`.
 */
export function useUsageDetail(
  featureKey: string,
  query: UsageQuery,
  options: { refreshKey: number; queue: UsageReadQueue; reportMaxDays: (n: number) => void; onRangeInvalid?: () => void },
): UsageDetailState {
  const { refreshKey, queue } = options;
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
    queue(() => adminUsageService.getDetail(featureKey, JSON.parse(queryKey) as UsageQuery))
      .then((data) => {
        if (id !== request.current) return;
        setResult({ key: queryKey, data });
        setUnavailable(false);
        callbacks.current.reportMaxDays(data.range.maxDays);
      })
      .catch((err: unknown) => {
        if (id !== request.current) return;
        const code = usageErrorCode(err);
        if (code === USAGE_ERROR_CODES.rangeInvalid) {
          callbacks.current.onRangeInvalid?.();
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
  }, [featureKey, queryKey, refreshKey, retry, queue]);

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
