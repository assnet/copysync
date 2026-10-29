import type { PrismaClient } from '@prisma/client';
import type { ILinkClickRepository, RecordLinkClickInput } from '../../domain/contracts/ILinkClickRepository';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Cliques contados (só ipHash, nunca IP cru). Agregado vive em `clickCount` da rotação/grupo. */
export class PrismaLinkClickRepository implements ILinkClickRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async record(input: RecordLinkClickInput): Promise<void> {
    await this.prisma.linkClick.create({
      data: {
        tenantId: input.tenantId,
        rotationId: input.rotationId,
        groupId: input.groupId,
        ipHash: input.ipHash,
        userAgentClass: input.userAgentClass,
        ...(input.createdAt && { createdAt: input.createdAt }),
      },
    });
  }

  /** Janela móvel (now − 7 dias, now]. Usa o índice (rotationId, createdAt). */
  async countLast7Days(tenantId: string, rotationId: string, now: Date): Promise<number> {
    return this.prisma.linkClick.count({
      where: { tenantId, rotationId, createdAt: { gt: new Date(now.getTime() - 7 * DAY_MS), lte: now } },
    });
  }

  async countLast7DaysByGroup(tenantId: string, rotationId: string, now: Date): Promise<Map<string, number>> {
    const rows = await this.prisma.linkClick.groupBy({
      by: ['groupId'],
      where: {
        tenantId,
        rotationId,
        groupId: { not: null },
        createdAt: { gt: new Date(now.getTime() - 7 * DAY_MS), lte: now },
      },
      _count: { _all: true },
    });
    return new Map(rows.flatMap((r) => (r.groupId ? [[r.groupId, r._count._all] as const] : [])));
  }

  /** Retenção global (job): sem tenantId de propósito, corta por idade em todos os tenants. */
  async deleteOlderThan(cutoff: Date): Promise<number> {
    const { count } = await this.prisma.linkClick.deleteMany({ where: { createdAt: { lt: cutoff } } });
    return count;
  }
}
