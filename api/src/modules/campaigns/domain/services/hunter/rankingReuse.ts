import type { OfferHuntRun } from '../../hunter/OfferHunt';

/** Ranking reaproveitável só de execuções das últimas 48 h (preço/estoque mudam). */
export const HUNT_RANKING_REUSE_MAX_AGE_HOURS = 48;
const MAX_AGE_MS = HUNT_RANKING_REUSE_MAX_AGE_HOURS * 3_600_000;

/** Dentro da janela pelo início da execução (borda inclusiva). */
export function isRankingWithinReuseWindow(run: Pick<OfferHuntRun, 'startedAt'>, now: Date): boolean {
  return now.getTime() - run.startedAt.getTime() <= MAX_AGE_MS;
}

/** Tem ranking gravado e está na janela; `ignoreAge` (super admin) dispensa a janela. */
export function isRankingReusable(run: Pick<OfferHuntRun, 'startedAt' | 'ranking'>, now: Date, opts: { ignoreAge?: boolean } = {}): boolean {
  return run.ranking !== null && run.ranking.length > 0 && (opts.ignoreAge === true || isRankingWithinReuseWindow(run, now));
}
