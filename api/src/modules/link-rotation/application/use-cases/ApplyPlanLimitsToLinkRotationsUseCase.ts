import { LinkRotationGroupStatus, LinkRotationStatus } from '../../domain/enums/LinkRotationEnums';
import type {
  ILinkRotationPlanEnforcementStore,
  PlanEnforcementGroup,
  StatusChange,
} from '../../domain/contracts/ILinkRotationPlanEnforcementStore';
import type { LinkRotationChannel } from '../../domain/services/inviteUrl';
import { groupStatusFor } from './groupInviteResolution';

/** Limites do plano em um canal; `null` = ilimitado. */
export interface LinkRotationChannelLimits {
  linkRotations: number | null;
  linkRotationGroups: number | null;
}

/** Limites por canal (WhatsApp: `link_rotations`/`link_rotation_groups`; Telegram: `telegram_*`). */
export type LinkRotationPlanLimits = Record<LinkRotationChannel, LinkRotationChannelLimits>;

export interface ApplyPlanLimitsInput {
  tenantId: string;
  limits: LinkRotationPlanLimits;
}

export interface ApplyPlanLimitsResult {
  rotationsChanged: number;
  groupsChanged: number;
}

const fits = (index: number, limit: number | null) => limit === null || index < Math.max(0, limit);

/**
 * Aplica o limite do plano (LROT-14), idempotente. Chamado depois de gravar entitlements.
 * Cada canal (engine da sessão do rodízio) tem seu próprio limite, sem um consumir vaga do outro.
 * - Rotações (por canal): as N mais antigas (createdAt, id) não pausadas pelo tenant ficam ACTIVE; o resto
 *   ACTIVE → PAUSED_BY_PLAN. PAUSED (pausa manual) nunca muda e não ocupa vaga.
 * - Grupos (por rotação): os N primeiros por position mantêm o status; excedentes → PAUSED_BY_PLAN.
 *   PAUSED_BY_PLAN que voltou a caber recebe o status calculado (NEEDS_LINK / FULL / ACTIVE).
 *   PAUSED manual do grupo nunca muda.
 */
export class ApplyPlanLimitsToLinkRotationsUseCase {
  constructor(private readonly store: ILinkRotationPlanEnforcementStore) {}

  async execute({ tenantId, limits }: ApplyPlanLimitsInput): Promise<ApplyPlanLimitsResult> {
    const rotations = await this.store.listForPlanLimits(tenantId);

    const rotationChanges: StatusChange<LinkRotationStatus>[] = [];
    const used: Record<LinkRotationChannel, number> = { whatsapp: 0, telegram: 0 };
    rotations
      .filter((r) => r.status !== LinkRotationStatus.PAUSED)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id))
      .forEach((r) => {
        const i = used[r.channel]++;
        const target = fits(i, limits[r.channel].linkRotations) ? LinkRotationStatus.ACTIVE : LinkRotationStatus.PAUSED_BY_PLAN;
        if (r.status !== target) rotationChanges.push({ id: r.id, status: target });
      });

    const groupChanges: StatusChange<LinkRotationGroupStatus>[] = [];
    for (const r of rotations) {
      [...r.groups]
        .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id))
        .forEach((g, i) => {
          const target = groupTarget(g, fits(i, limits[r.channel].linkRotationGroups));
          if (target !== g.status) groupChanges.push({ id: g.id, status: target });
        });
    }

    if (rotationChanges.length) await this.store.setRotationStatuses(tenantId, rotationChanges);
    if (groupChanges.length) await this.store.setGroupStatuses(tenantId, groupChanges);
    return { rotationsChanged: rotationChanges.length, groupsChanged: groupChanges.length };
  }
}

function groupTarget(g: PlanEnforcementGroup, withinLimit: boolean): LinkRotationGroupStatus {
  if (g.status === LinkRotationGroupStatus.PAUSED) return g.status;
  if (!withinLimit) return LinkRotationGroupStatus.PAUSED_BY_PLAN;
  if (g.status !== LinkRotationGroupStatus.PAUSED_BY_PLAN) return g.status;
  return groupStatusFor(!!g.inviteCode, g.memberCount, g.capacity);
}
