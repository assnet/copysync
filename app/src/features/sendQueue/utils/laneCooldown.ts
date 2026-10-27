import type { SendQueueSession } from '@/types/api.types';

export interface LaneCooldown {
  /** Início da espera (ms, relógio do servidor): início do último envio da sessão. */
  startMs: number;
  /** Horário previsto do próximo envio (ms, relógio do servidor). */
  endMs: number;
}

/**
 * Espera até o próximo envio da sessão: do início do último envio (em curso ou o concluído mais
 * recente) até o `notBefore` do primeiro da fila que não está pausado. Sem próximo: null.
 */
export function laneCooldown(session: SendQueueSession): LaneCooldown | null {
  const next = session.waiting.find((w) => w.offerStatus !== 'PAUSED');
  if (!next) return null;
  const endMs = Date.parse(next.notBefore);
  const lastStart = session.running?.claimedAt ?? session.recent.find((r) => r.claimedAt)?.claimedAt ?? null;
  const startMs = lastStart ? Math.min(Date.parse(lastStart), endMs) : endMs;
  return { startMs, endMs };
}
