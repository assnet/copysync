import type { OfferDispatchItem } from '@/types/api.types';

export interface DispatchCooldown {
  next: OfferDispatchItem;
  /** `notBefore` do envio anterior na agenda (ms, relógio do servidor). */
  startMs: number;
  /** `notBefore` do próximo envio (ms, relógio do servidor). */
  endMs: number;
}

/**
 * Espera até o próximo envio da fila. A API agenda cada envio com um intervalo sorteado entre
 * o mínimo e o máximo configurados, encadeado a partir do anterior; a janela é a diferença entre
 * os dois `notBefore`. Primeiro da fila: janela vazia (sai na hora). Sem fila: null.
 */
export function nextDispatchCooldown(dispatches: readonly OfferDispatchItem[]): DispatchCooldown | null {
  const sorted = [...dispatches].sort((a, b) => Date.parse(a.notBefore) - Date.parse(b.notBefore));
  const index = sorted.findIndex((d) => d.status === 'QUEUED');
  if (index < 0) return null;
  const next = sorted[index]!;
  const endMs = Date.parse(next.notBefore);
  const startMs = index > 0 ? Date.parse(sorted[index - 1]!.notBefore) : endMs;
  return { next, startMs, endMs };
}
