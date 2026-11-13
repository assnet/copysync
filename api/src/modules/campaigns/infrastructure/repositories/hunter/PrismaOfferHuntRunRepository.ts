import { Prisma, type PrismaClient } from '@prisma/client';
import type {
  FinishOfferHuntRunInput,
  IOfferHuntRunRepository,
  OfferHuntPageCursor,
  StartOfferHuntRunInput,
} from '../../../domain/contracts/hunter/IOfferHuntRunRepository';
import type { OfferHuntRun, OfferHuntRunSummary } from '../../../domain/hunter/OfferHunt';
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
        data: {
          tenantId: input.tenantId, huntId: input.huntId, provider: input.provider, trigger: input.trigger, startedAt: input.startedAt,
          status: 'RUNNING',
        },
      });
    });
    return raw ? Mapper.runToDomain(raw) : null;
  }

  async createSkipped(input: StartOfferHuntRunInput & { errorCode: string }): Promise<OfferHuntRun> {
    const raw = await this.prisma.offerHuntRun.create({
      data: {
        tenantId: input.tenantId, huntId: input.huntId, provider: input.provider, trigger: input.trigger, status: 'SKIPPED',
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

  async listByHunt(tenantId: string, huntId: string, page: { limit: number; after?: OfferHuntPageCursor }): Promise<OfferHuntRunSummary[]> {
    const after = page.after;
    const rows = await this.prisma.offerHuntRun.findMany({
      where: {
        tenantId, huntId,
        ...(after ? { OR: [{ startedAt: { lt: after.at } }, { startedAt: after.at, id: { lt: after.id } }] } : {}),
      },
      orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
      take: page.limit,
      select: RUN_SUMMARY_SELECT,
    });
    if (rows.length === 0) return [];
    // Só os ids com ranking (a coluna não vem para a lista)
    const ranked = await this.prisma.offerHuntRun.findMany({
      where: { tenantId, id: { in: rows.map((r) => r.id) }, ranking: { not: Prisma.DbNull } },
      select: { id: true },
    });
    const has = new Set(ranked.map((r) => r.id));
    return rows.map((r) => Mapper.runSummaryToDomain(r, has.has(r.id)));
  }

  async findById(tenantId: string, huntId: string, id: string): Promise<OfferHuntRun | null> {
    const raw = await this.prisma.offerHuntRun.findFirst({ where: { id, tenantId, huntId } });
    return raw ? Mapper.runToDomain(raw) : null;
  }
}

/** Todas as colunas menos `ranking`. */
const RUN_SUMMARY_SELECT = {
  id: true, tenantId: true, huntId: true, provider: true, trigger: true, status: true, seenCount: true, matchedCount: true, chosenCount: true,
  sentCount: true, aiUsed: true, aiFallback: true, rejectedBy: true, errorCode: true, startedAt: true, finishedAt: true,
} satisfies Prisma.OfferHuntRunSelect;
