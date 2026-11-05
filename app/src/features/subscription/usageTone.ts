/** Cor do uso × limite, comum ao chip do gerador e à tabela de limites. */
export type UsageTone = 'default' | 'warning' | 'error';

/**
 * Regra única: sem teto (`null`) → `default`; esgotado → `error`; restando ≤ 20% do limite
 * (arredondado para cima, ou seja, uso ≥ 80%) → `warning`; senão `default`.
 */
export function usageTone(used: number, limit: number | null): UsageTone {
  if (limit == null) return 'default';
  const remaining = Math.max(limit - used, 0);
  if (remaining === 0) return 'error';
  return remaining <= Math.ceil(limit * 0.2) ? 'warning' : 'default';
}
