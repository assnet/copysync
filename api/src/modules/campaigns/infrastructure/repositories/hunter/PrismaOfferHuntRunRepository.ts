import type { PrismaClient } from '@prisma/client';
import type {
  FinishOfferHuntRunInput,
  IOfferHuntRunRepository,
  OfferHuntPageCursor,
  StartOfferHuntRunInput,
} from '../../../domain/contracts/hunter/IOfferHuntRunRepository';
import type { OfferHuntRun } from '../../../domain/hunter/OfferHunt';
import { PrismaOfferHuntMapper as Mapper, rankingToData, rejectionsToData } from '../../mappers/PrismaOfferHuntMapper';

const countsTowardGuard = (tenantId: string, since: Date) => ({ tenantId, startedAt: { gte: since }, status: { not: 'SKIPPED' as const } });

export class PrismaOfferHuntRunRepository implements IOfferHuntRunRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /** Advisory lock por tenant até o fim da transação: a recontagem e a abertura são uma coisa só. */
  async startWithinDailyLimit(input: StartOfferHuntRunInput, quota: { since: Date; limit: number }): Promise<OfferHuntRun | null> {
    const raw = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`offer_hunt_runs:${input.tenantId}`}::text))`;
      if ((await tx.offerHuntRun.count({ where: countsTowardGuard(input.tenantId, quota.since) })) >= quota.limit) return null;
      return tx.offerHuntRun.create({
        data: { tenantId: input.tenantId, huntId: input.huntId, trigger: input.trigger, startedAt: input.startedAt, status: 'RUNNING' },
      });
    });
    return raw ? Mapper.runToDomain(raw) : null;
  }

  async createSkipped(input: StartOfferHuntRunInput & { errorCode: string }): Promise<OfferHuntRun> {
    const raw = await this.prisma.offerHuntRun.create({
      data: {
        tenantId: input.tenantId, huntId: input.huntId, trigger: input.trigger, status: 'SKIPPED',
        errorCode: input.errorCode, startedAt: input.startedAt, finishedAt: input.startedAt,
      },
    });
    return Mapper.runToDomain(raw);
  }

  async finish(tenantId: string, id: string, input: FinishOfferHuntRunInput): Promise<void> {
    const { rejectedBy, ranking, ...rest } = input;
    await this.prisma.offerHuntRun.updateMany({
      where: { id, tenantId, status: 'RUNNING' },
      data: { ...rest, rejectedBy: rejectionsToData(rejectedBy), ranking: rankingToData(ranking) },
    });
  }

  countStartedSince(tenantId: string, since: Date): Promise<number> {
    return this.prisma.offerHuntRun.count({ where: countsTowardGuard(tenantId, since) });
  }

  async incrementSent(tenantId: string, id: string): Promise<void> {
    await this.prisma.offerHuntRun.updateMany({ where: { id, tenantId }, data: { sentCount: { increment: 1 } } });
  }

  async listByHunt(tenantId: string, huntId: string, page: { limit: number; after?: OfferHuntPageCursor }): Promise<OfferHuntRun[]> {
    const after = page.after;
    const rows = await this.prisma.offerHuntRun.findMany({
      where: {
        tenantId, huntId,
        ...(after ? { OR: [{ startedAt: { lt: after.at } }, { startedAt: after.at, id: { lt: after.id } }] } : {}),
      },
      orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
      take: page.limit,
    });
    return rows.map(Mapper.runToDomain);
  }
}
