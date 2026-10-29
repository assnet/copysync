import { PLAN_CATALOG } from '@/features/plans/catalog';

export type PlanLimitKind = 'rotations' | 'groups';

export interface NextPlanOffer {
  name: string;
  limit: number;
}

/**
 * Menor plano da vitrine (`features/plans/catalog.ts`, em ordem crescente) que permite mais que o
 * limite atual. `null` = o tenant já está no teto: o aviso não oferece upgrade.
 * Regra pura: não consulta o plano do tenant, só compara números.
 */
export function nextPlanFor(kind: PlanLimitKind, currentLimit: number): NextPlanOffer | null {
  for (const plan of PLAN_CATALOG) {
    const limit = kind === 'rotations' ? plan.limits.linkRotations : plan.limits.linkRotationGroups;
    if (limit > currentLimit) return { name: plan.name, limit };
  }
  return null;
}
