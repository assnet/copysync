import type { ILinkClickRepository } from '../../domain/contracts/ILinkClickRepository';
import type { LinkRotationGroupStatus } from '../../domain/enums/LinkRotationEnums';
import { LinkRotationNotFoundError } from '../../../../shared/errors/internal/LinkRotationErrors';
import type { LinkRotationUseCaseDeps } from './linkRotationUseCaseDeps';

type Deps = Pick<LinkRotationUseCaseDeps, 'rotations' | 'groups' | 'now'> & {
  clicks: Pick<ILinkClickRepository, 'countLast7Days' | 'countLast7DaysByGroup'>;
};

export interface LinkRotationGroupStatsDTO {
  id: string;
  conversationId: string;
  groupName: string | null;
  status: LinkRotationGroupStatus;
  clickCount: number;
  clicksLast7Days: number;
  memberCount: number | null;
  capacity: number;
}

export interface LinkRotationStatsDTO {
  rotationId: string;
  clickCount: number;
  clicksLast7Days: number;
  lastClickAt: Date | null;
  groups: LinkRotationGroupStatsDTO[];
}

/**
 * Estatísticas de uma rotação do tenant: total (agregado `clickCount`) e janela móvel de 7 dias
 * (`link_clicks`, retidos 90 dias), na rotação e por grupo. Rotação de outro tenant → 404.
 */
export class GetLinkRotationStatsUseCase {
  constructor(private readonly deps: Deps) {}

  async execute(tenantId: string, rotationId: string): Promise<LinkRotationStatsDTO> {
    const { rotations, groups, clicks } = this.deps;
    const now = this.deps.now?.() ?? new Date();

    const rotation = await rotations.findById(tenantId, rotationId);
    if (!rotation) throw new LinkRotationNotFoundError(rotationId);

    const [total7, byGroup, candidates] = await Promise.all([
      clicks.countLast7Days(tenantId, rotationId, now),
      clicks.countLast7DaysByGroup(tenantId, rotationId, now),
      groups.findGroups(tenantId, rotation.groups.map((g) => g.conversationId)),
    ]);
    const names = new Map(candidates.map((c) => [c.conversationId, c.name]));

    return {
      rotationId: rotation.id,
      clickCount: rotation.clickCount,
      clicksLast7Days: total7,
      lastClickAt: rotation.lastClickAt,
      groups: rotation.groups.map((g) => ({
        id: g.id,
        conversationId: g.conversationId,
        groupName: names.get(g.conversationId) ?? null,
        status: g.status,
        clickCount: g.clickCount,
        clicksLast7Days: byGroup.get(g.id) ?? 0,
        memberCount: g.memberCount,
        capacity: g.capacity,
      })),
    };
  }
}
