import type { RedirectSide } from '../entities/RedirectLink';

/**
 * Sorteio A/B. `rng` devolve [0, 1) (padrão `Math.random`; injetável no teste).
 * Sem B → sempre A. Com B → A quando `rng() * 100 < percentA` (0 = sempre B, 100 = sempre A).
 */
export function pickRedirectSide(
  link: { urlB: string | null; percentA: number },
  rng: () => number = Math.random,
): RedirectSide {
  if (!link.urlB) return 'A';
  return rng() * 100 < link.percentA ? 'A' : 'B';
}
