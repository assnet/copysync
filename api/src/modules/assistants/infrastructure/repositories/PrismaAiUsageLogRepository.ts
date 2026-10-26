import type { PrismaClient } from '@prisma/client';
import type {
  AiUsageOutcome,
  AiUsageQuota,
  IAiUsageLogRepository,
} from '../../domain/contracts/IAiUsageLogRepository';
import type { AiUsageEntry } from '../../domain/contracts/AiRecords';

/** Uma linha por chamada, sem prompt nem resposta. Índice `(tenantId, createdAt)`. */
export class PrismaAiUsageLogRepository implements IAiUsageLogRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async record(entry: AiUsageEntry): Promise<void> {
    await this.prisma.aiUsageLog.create({ data: entry });
  }

  /**
   * `pg_advisory_xact_lock(hashtext('ai:' || tenantId))` serializa reservas concorrentes do
   * tenant até o fim da transação curta: duas chamadas não passam juntas pela recontagem.
   */
  async reserveWithinDailyLimit(entry: AiUsageEntry, quota: AiUsageQuota): Promise<string | null> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('ai:' || ${entry.tenantId}::text))`;
      const used = await tx.aiUsageLog.count({
        where: { tenantId: entry.tenantId, source: entry.source, createdAt: { gte: quota.since } },
      });
      if (used >= quota.limit) return null;
      const row = await tx.aiUsageLog.create({ data: entry, select: { id: true } });
      return row.id;
    });
  }

  async complete(id: string, tenantId: string, outcome: AiUsageOutcome): Promise<void> {
    await this.prisma.aiUsageLog.updateMany({ where: { id, tenantId }, data: outcome });
  }
}
