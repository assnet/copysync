import type { PrismaClient } from '@prisma/client';
import type {
  ILinkRotationPlanEnforcementStore,
  PlanEnforcementRotation,
  StatusChange,
} from '../../domain/contracts/ILinkRotationPlanEnforcementStore';
import { LinkRotationStatus, type LinkRotationGroupStatus } from '../../domain/enums/LinkRotationEnums';

/** Client normal ou de transação (`TransactionClient`): só os modelos usados aqui. */
export type PlanEnforcementClient = Pick<PrismaClient, 'linkRotation' | 'linkRotationGroup'>;

/** Agrupa mudanças por status: um `updateMany` por status, sempre com `tenantId`. */
function byStatus<S extends string>(changes: StatusChange<S>[]): Map<S, string[]> {
  const out = new Map<S, string[]>();
  for (const c of changes) out.set(c.status, [...(out.get(c.status) ?? []), c.id]);
  return out;
}

export class PrismaLinkRotationPlanEnforcementStore implements ILinkRotationPlanEnforcementStore {
  constructor(private readonly prisma: PlanEnforcementClient) {}

  async listForPlanLimits(tenantId: string): Promise<PlanEnforcementRotation[]> {
    const rows = await this.prisma.linkRotation.findMany({
      where: { tenantId },
      select: {
        id: true,
        status: true,
        createdAt: true,
        groups: {
          where: { tenantId },
          select: { id: true, position: true, status: true, inviteCode: true, memberCount: true, capacity: true },
        },
      },
    });
    return rows.map((r) => ({
      id: r.id,
      status: r.status as LinkRotationStatus,
      createdAt: r.createdAt,
      groups: r.groups.map((g) => ({ ...g, status: g.status as LinkRotationGroupStatus })),
    }));
  }

  async setRotationStatuses(tenantId: string, changes: StatusChange<LinkRotationStatus>[]): Promise<void> {
    for (const [status, ids] of byStatus(changes)) {
      await this.prisma.linkRotation.updateMany({ where: { tenantId, id: { in: ids } }, data: { status } });
    }
  }

  async setGroupStatuses(tenantId: string, changes: StatusChange<LinkRotationGroupStatus>[]): Promise<void> {
    for (const [status, ids] of byStatus(changes)) {
      await this.prisma.linkRotationGroup.updateMany({ where: { tenantId, id: { in: ids } }, data: { status } });
    }
  }

  async pauseBySession(tenantId: string, sessionId: string): Promise<number> {
    const { count } = await this.prisma.linkRotation.updateMany({
      where: { tenantId, sessionId, status: { not: LinkRotationStatus.PAUSED } },
      data: { status: LinkRotationStatus.PAUSED },
    });
    return count;
  }
}
