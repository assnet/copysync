import type { PrismaClient } from '@prisma/client';
import type {
  ApplyMemberCountInput,
  ILinkRotationMemberSyncStore,
  MemberSyncDueGroup,
  MemberSyncDueQuery,
} from '../../domain/contracts/ILinkRotationMemberSyncStore';
import { LinkRotationGroupStatus } from '../../domain/enums/LinkRotationEnums';

/** Job de membros do rodízio: varredura global (todos os tenants); escrita sempre por id + tenantId. */
export class PrismaLinkRotationMemberSyncStore implements ILinkRotationMemberSyncStore {
  constructor(private readonly prisma: PrismaClient) {}

  async listDue(q: MemberSyncDueQuery): Promise<MemberSyncDueGroup[]> {
    const rows = await this.prisma.linkRotationGroup.findMany({
      where: {
        status: { in: ['ACTIVE', 'FULL'] },
        rotation: {
          status: 'ACTIVE',
          session: { status: 'CONNECTED', deletedAt: null },
          tenant: { status: 'ACTIVE' },
        },
        OR: [
          { memberCountAt: null },
          { memberCountAt: { lt: q.staleBefore } },
          { clicksSinceSync: { gte: q.clickBurst }, memberCountAt: { lt: q.burstBefore } },
        ],
      },
      orderBy: [{ memberCountAt: { sort: 'asc', nulls: 'first' } }, { id: 'asc' }],
      take: q.limit,
      select: {
        id: true, tenantId: true, rotationId: true, groupJid: true, capacity: true, status: true,
        clicksSinceSync: true, rotation: { select: { sessionId: true } },
      },
    });
    return rows.map((r) => ({
      id: r.id,
      tenantId: r.tenantId,
      rotationId: r.rotationId,
      sessionId: r.rotation.sessionId,
      groupJid: r.groupJid,
      capacity: r.capacity,
      status: r.status as LinkRotationGroupStatus,
      clicksSinceSync: r.clicksSinceSync,
    }));
  }

  /**
   * Um UPDATE: contagem e horário sempre; `clicksSinceSync` desconta só o que foi visto (nunca < 0);
   * status só troca se o grupo ainda está ACTIVE/FULL (pausa manual/plano concorrente vence).
   */
  async applyMemberCount(input: ApplyMemberCountInput): Promise<void> {
    const status = input.status === LinkRotationGroupStatus.FULL ? 'FULL' : 'ACTIVE';
    await this.prisma.$executeRaw`
      UPDATE "link_rotation_groups" SET
        "memberCount" = ${input.memberCount},
        "memberCountAt" = ${input.at},
        "clicksSinceSync" = GREATEST(0, "clicksSinceSync" - ${input.clicksSeen}),
        "status" = CASE WHEN "status" IN ('ACTIVE', 'FULL')
          THEN ${status}::"LinkRotationGroupStatus" ELSE "status" END,
        "updatedAt" = ${input.at}
      WHERE "id" = ${input.groupId} AND "tenantId" = ${input.tenantId}`;
  }

  async markAttempt(tenantId: string, groupId: string, at: Date): Promise<void> {
    await this.prisma.linkRotationGroup.updateMany({ where: { id: groupId, tenantId }, data: { memberCountAt: at } });
  }
}
