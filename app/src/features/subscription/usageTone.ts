/** Cor do uso × limite, comum ao chip do gerador e à tabela de limites. */
export type UsageTone = 'default' | 'warning' | 'error';

/**
 * Regra única: sem teto (`null`) → `default`; esgotado → `error`; restando ≤ 20% do limite
 * (arredondado para cima, ou seja, uso ≥ 80%) → `warning`; senão `default`. Nada usado nunca
 * alerta (`0 de 1` seria `warning` pela regra do restante).
 */
export function usageTone(used: number, limit: number | null): UsageTone {
  if (limit == null) return 'default';
  const remaining = Math.max(limit - used, 0);
  if (remaining === 0) return 'error';
  if (used <= 0) return 'default';
  return remaining <= Math.ceil(limit * 0.2) ? 'warning' : 'default';
}

/**
 * Como cada chave de limite reage ao uso. `consumption` (padrão) = cota que se gasta: alerta perto
 * do fim e erro no limite. `selection` = vagas que o usuário preenche de propósito (ex.: etiquetas
 * do ML no LITE, 1 de 1): estar no limite é o estado normal, então fica neutro; só passar do
 * limite (ex.: após rebaixar o plano) vira erro. Chave nova entra aqui, nunca com `if` na tela.
 */
export type UsageTonePolicy = 'consumption' | 'selection';

export const USAGE_TONE_POLICY: Readonly<Record<string, UsageTonePolicy>> = {
  mercado_livre_affiliate_tags: 'selection',
};

/** `usageTone` segundo a política da chave (`USAGE_TONE_POLICY`; ausente = `consumption`). */
export function usageToneFor(key: string, used: number, limit: number | null): UsageTone {
  if ((USAGE_TONE_POLICY[key] ?? 'consumption') === 'selection') {
    return limit != null && used > limit ? 'error' : 'default';
  }
  return usageTone(used, limit);
}
