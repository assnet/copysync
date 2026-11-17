import { useCallback, useEffect, useRef, useState } from 'react';
import { isServiceUnavailable } from '@/services/apiClient';
import { adminUsageService } from '@/services/adminUsage.service';
import { USAGE_ERROR_CODES, usageErrorCode, isUsageReadSuperseded } from '../rules';
import type { UsageQuery, UsageSummary } from '../types';

export interface UsageSummaryState {
  /** Resposta do recorte atual; `null` enquanto não há resposta para ele. Nunca persistida. */
  data: UsageSummary | null;
  loading: boolean;
  /** Erro comum (Alert com "Tentar de novo"). */
  error: boolean;
  /** 503 `USAGE_METRICS_READ_UNAVAILABLE` (leitura lenta ou outra em andamento): mesmo Alert, texto próprio. */
  slow: boolean;
  /** API fora do ar (deploy): `ServiceUpdatingState`. Só limpa quando uma leitura conclui. */
  unavailable: boolean;
  /**
   * A última leitura pedida (recorte, "Atualizar" e "Tentar de novo") concluiu com sucesso. Calculado na renderização:
   * fica `false` já na renderização que muda o recorte. A tendência só lê com `ready` (depois do resumo).
   */
  ready: boolean;
  reload: () => void;
}

/**
 * Resumo do uso (`GET /admin/usage/summary`). A query vem pronta (`toUsageQuery`) e a chave dela decide quando
 * recarregar. O `apiClient` não cancela pedido: resposta de recorte antigo é descartada pelo id do pedido.
 * A leitura passa pela fila do serviço (uma por vez por aba; o duplo efeito do StrictMode reaproveita o pedido em
 * voo). `enabled = false` (detalhe aberto) não pede o resumo.
 * 400 `USAGE_METRICS_RANGE_INVALID` chama `onRangeInvalid` (a tela volta ao preset padrão), sem virar erro genérico.
 */
export function useUsageSummary(
  query: UsageQuery,
  options: { enabled?: boolean; refreshKey?: number; onRangeInvalid?: () => void } = {},
): UsageSummaryState {
  const { enabled = true, refreshKey = 0, onRangeInvalid } = options;
  const queryKey = JSON.stringify(query);
  const [result, setResult] = useState<{ key: string; read: string; data: UsageSummary } | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState(false);
  const [slow, setSlow] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [retry, setRetry] = useState(0);
  const request = useRef(0);
  const readId = `${queryKey}|${refreshKey}|${retry}`;
  const rangeInvalid = useRef(onRangeInvalid);
  rangeInvalid.current = onRangeInvalid;

  useEffect(() => {
    if (!enabled) {
      request.current += 1;
      setLoading(false);
      return;
    }
    const id = ++request.current;
    const read = `${queryKey}|${refreshKey}|${retry}`;
    setLoading(true);
    setError(false);
    setSlow(false);
    adminUsageService.getSummary(JSON.parse(queryKey) as UsageQuery)
      .then((data) => {
        if (id !== request.current) return;
        setResult({ key: queryKey, read, data });
        setUnavailable(false);
      })
      .catch((err: unknown) => {
        if (id !== request.current || isUsageReadSuperseded(err)) return;
        const code = usageErrorCode(err);
        if (code === USAGE_ERROR_CODES.rangeInvalid) {
          rangeInvalid.current?.();
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
  }, [queryKey, enabled, refreshKey, retry]);

  const reload = useCallback(() => setRetry((n) => n + 1), []);

  return {
    data: result && result.key === queryKey ? result.data : null,
    loading,
    error,
    slow,
    unavailable,
    ready: enabled && result !== null && result.read === readId,
    reload,
  };
}
