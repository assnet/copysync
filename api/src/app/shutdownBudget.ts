/**
 * Teto do drain de mídia no shutdown com a adoção ligada (ADOPT-14, D4). A Render dá 30 s entre
 * SIGTERM e SIGKILL; o processo mira 27 s e reserva 10 s para fechar sockets, flush e soltar
 * leases (o flush tem prioridade sobre envio de mídia em voo). Função pura.
 */
export const SHUTDOWN_DEADLINE_MS = 27_000;
export const SHUTDOWN_TAIL_RESERVE_MS = 10_000;

/** `max(0, prazo − decorrido − reserva)`; decorrido inválido/negativo conta como 0. */
export function mediaDrainBudgetMs(
  elapsedMs: number,
  deadlineMs: number = SHUTDOWN_DEADLINE_MS,
  reserveMs: number = SHUTDOWN_TAIL_RESERVE_MS,
): number {
  const elapsed = Number.isFinite(elapsedMs) && elapsedMs > 0 ? elapsedMs : 0;
  return Math.max(0, Math.floor(deadlineMs - elapsed - reserveMs));
}
