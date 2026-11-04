/** Regras puras da tela de workers (sem React). */

export type OccupancyLevel = 'ok' | 'warning' | 'full';

/** Ocupação em % (0–100, inteiro). Teto 0 conta como cheio se houver sessão. */
export function occupancyPercent(sessions: number, maxSessions: number): number {
  if (maxSessions <= 0) return sessions > 0 ? 100 : 0;
  return Math.min(100, Math.max(0, Math.round((sessions / maxSessions) * 100)));
}

/** Faixa de cor: até 79% ok, 80–99% atenção, 100% cheio. */
export function occupancyLevel(sessions: number, maxSessions: number): OccupancyLevel {
  const pct = occupancyPercent(sessions, maxSessions);
  if (pct >= 100) return 'full';
  return pct >= 80 ? 'warning' : 'ok';
}

/** Ordem da tabela: mais ocupado primeiro, empate pelo id. */
export function sortWorkers<T extends { workerId: string; sessions: number; maxSessions: number }>(list: T[]): T[] {
  return [...list].sort(
    (a, b) => occupancyPercent(b.sessions, b.maxSessions) - occupancyPercent(a.sessions, a.maxSessions)
      || a.workerId.localeCompare(b.workerId),
  );
}
