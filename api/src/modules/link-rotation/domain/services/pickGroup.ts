import { LinkRotationGroupStatus, LinkRotationStrategy } from '../enums/LinkRotationEnums';
import type { LinkRotationGroup } from '../entities/LinkRotationGroup';

/** Campos que a escolha lê; aceita a entidade inteira. */
export type PickableGroup = Pick<
  LinkRotationGroup,
  'status' | 'inviteCode' | 'memberCount' | 'clicksSinceSync' | 'capacity' | 'clickCount' | 'position' | 'weight'
>;

/** Membros estimados: última leitura da sessão + cliques desde então. */
export function estimatedMembers(group: PickableGroup): number {
  return (group.memberCount ?? 0) + group.clicksSinceSync;
}

export function isEligible(group: PickableGroup): boolean {
  return (
    group.status === LinkRotationGroupStatus.ACTIVE &&
    !!group.inviteCode &&
    estimatedMembers(group) < group.capacity
  );
}

const byPosition = (a: PickableGroup, b: PickableGroup) => a.position - b.position;

/**
 * Escolhe o grupo do clique. Função pura: `rng` injetável (0 ≤ rng() < 1) para teste.
 * - BALANCED: menor ocupação estimada/capacidade; empate → menor clickCount → menor position.
 * - SEQUENTIAL: menor position entre elegíveis (cheio/sem convite ficam de fora).
 * - WEIGHTED: roleta por weight; peso ≤ 0 não concorre.
 * - RANDOM: uniforme.
 * Nenhum elegível → null.
 */
export function pickGroup<T extends PickableGroup>(
  groups: readonly T[],
  strategy: LinkRotationStrategy,
  rng: () => number = Math.random,
): T | null {
  const eligible = groups.filter(isEligible).sort(byPosition);
  if (eligible.length === 0) return null;

  switch (strategy) {
    case LinkRotationStrategy.SEQUENTIAL:
      return eligible[0];

    case LinkRotationStrategy.BALANCED: {
      const load = (g: T) => estimatedMembers(g) / g.capacity;
      return eligible.reduce((best, g) => {
        const diff = load(g) - load(best);
        if (diff !== 0) return diff < 0 ? g : best;
        if (g.clickCount !== best.clickCount) return g.clickCount < best.clickCount ? g : best;
        return best; // já ordenado por position
      });
    }

    case LinkRotationStrategy.WEIGHTED: {
      const weighted = eligible.filter((g) => g.weight > 0);
      const total = weighted.reduce((sum, g) => sum + g.weight, 0);
      if (total <= 0) return null;
      let target = rng() * total;
      for (const g of weighted) {
        target -= g.weight;
        if (target < 0) return g;
      }
      return weighted[weighted.length - 1];
    }

    case LinkRotationStrategy.RANDOM: {
      const index = Math.min(Math.floor(rng() * eligible.length), eligible.length - 1);
      return eligible[Math.max(index, 0)];
    }

    default:
      return null;
  }
}
