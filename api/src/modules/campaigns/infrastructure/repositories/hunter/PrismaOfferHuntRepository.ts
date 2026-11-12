import { randomUUID } from 'crypto';
import type { PrismaClient } from '@prisma/client';
import type {
  CreateOfferHuntInput,
  IOfferHuntRepository,
  OfferHuntClaim,
  OfferHuntPatch,
} from '../../../domain/contracts/hunter/IOfferHuntRepository';
import type { OfferHunt, OfferHuntPauseReason } from '../../../domain/hunter/OfferHunt';
import { PrismaOfferHuntMapper as Mapper } from '../../mappers/PrismaOfferHuntMapper';

/** Chave do advisory lock por tenant (namespaces separados por prefixo). */
const lockKey = (scope: string, tenantId: string) => `${scope}:${tenantId}`;

export class PrismaOfferHuntRepository implements IOfferHuntRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async createWithinLimit(input: CreateOfferHuntInput, max: number): Promise<OfferHunt | null> {
    const { tenantId, nextRunAt, ...definition } = input;
    const raw = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey('offer_hunts', tenantId)}::text))`;
      if ((await tx.offerHunt.count({ where: { tenantId } })) >= max) return null;
      return tx.offerHunt.create({
        data: { ...(Mapper.definitionToData(definition) as Record<string, unknown>), name: definition.name, tenantId, nextRunAt },
      });
    });
    return raw ? Mapper.huntToDomain(raw) : null;
  }

  async findById(tenantId: string, id: string): Promise<OfferHunt | null> {
    const raw = await this.prisma.offerHunt.findFirst({ where: { id, tenantId } });
    return raw ? Mapper.huntToDomain(raw) : null;
  }

  async listByTenant(tenantId: string): Promise<OfferHunt[]> {
    const rows = await this.prisma.offerHunt.findMany({ where: { tenantId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
    return rows.map(Mapper.huntToDomain);
  }

  countByTenant(tenantId: string): Promise<number> {
    return this.prisma.offerHunt.count({ where: { tenantId } });
  }

  async update(tenantId: string, id: string, patch: OfferHuntPatch): Promise<OfferHunt | null> {
    const { nextRunAt, ...definition } = patch;
    const data = { ...Mapper.definitionToData(definition), ...(nextRunAt !== undefined ? { nextRunAt } : {}) };
    const { count } = await this.prisma.offerHunt.updateMany({ where: { id, tenantId }, data });
    return count > 0 ? this.findById(tenantId, id) : null;
  }

  async delete(tenantId: string, id: string): Promise<boolean> {
    const { count } = await this.prisma.offerHunt.deleteMany({ where: { id, tenantId } });
    return count > 0;
  }

  async pause(tenantId: string, id: string, reason: OfferHuntPauseReason): Promise<boolean> {
    const { count } = await this.prisma.offerHunt.updateMany({ where: { id, tenantId }, data: { status: 'PAUSED', pauseReason: reason } });
    return count > 0;
  }

  async resume(tenantId: string, id: string, nextRunAt: Date | null): Promise<boolean> {
    const { count } = await this.prisma.offerHunt.updateMany({
      where: { id, tenantId, status: 'PAUSED' },
      data: { status: 'ACTIVE', pauseReason: null, consecutiveFailures: 0, nextRunAt },
    });
    return count > 0;
  }

  async recordSuccess(tenantId: string, id: string, at: Date): Promise<void> {
    await this.prisma.offerHunt.updateMany({ where: { id, tenantId }, data: { lastRunAt: at, consecutiveFailures: 0 } });
  }

  /** Um UPDATE só: incremento e pausa atômicos (duas falhas simultâneas não se perdem). */
  async recordSourceFailure(tenantId: string, id: string, at: Date, pauseAfter: number): Promise<{ consecutiveFailures: number; paused: boolean }> {
    const rows = await this.prisma.$queryRaw<{ consecutiveFailures: number; status: string }[]>`
      UPDATE "offer_hunts"
         SET "consecutiveFailures" = "consecutiveFailures" + 1,
             "lastRunAt" = ${at},
             "status" = CASE WHEN "consecutiveFailures" + 1 >= ${pauseAfter} THEN 'PAUSED'::"OfferHuntStatus" ELSE "status" END,
             "pauseReason" = CASE WHEN "consecutiveFailures" + 1 >= ${pauseAfter} THEN 'SOURCE_UNAVAILABLE'::"OfferHuntPauseReason" ELSE "pauseReason" END,
             "updatedAt" = NOW()
       WHERE "id" = ${id} AND "tenantId" = ${tenantId}
   RETURNING "consecutiveFailures", "status"::text AS "status"`;
    const r = rows[0];
    return r ? { consecutiveFailures: r.consecutiveFailures, paused: r.consecutiveFailures >= pauseAfter } : { consecutiveFailures: 0, paused: false };
  }

  /**
   * Candidatas: a mais vencida de cada tenant sem posse vigente. Cada claim roda numa transação com
   * advisory lock do tenant e recontagem das posses vigentes: dois processos não pegam 2 do mesmo tenant.
   */
  async claimDue(now: Date, limit: number, leaseMs: number): Promise<OfferHuntClaim[]> {
    if (limit <= 0) return [];
    const candidates = await this.prisma.$queryRaw<{ id: string; tenantId: string }[]>`
      SELECT "id", "tenantId" FROM (
        SELECT DISTINCT ON (h."tenantId") h."id", h."tenantId", h."nextRunAt"
          FROM "offer_hunts" h
         WHERE h."status" = 'ACTIVE' AND h."nextRunAt" <= ${now}
           AND NOT EXISTS (
             SELECT 1 FROM "offer_hunts" o
              WHERE o."tenantId" = h."tenantId" AND o."claimedUntil" IS NOT NULL AND o."claimedUntil" > ${now})
         ORDER BY h."tenantId", h."nextRunAt" ASC, h."id" ASC
      ) d
      ORDER BY d."nextRunAt" ASC, d."id" ASC
      LIMIT ${limit * 3}`;
    const claimed: OfferHuntClaim[] = [];
    const until = new Date(now.getTime() + leaseMs);
    for (const c of candidates) {
      if (claimed.length >= limit) break;
      const token = randomUUID();
      const raw = await this.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey('offer_hunt_claim', c.tenantId)}::text))`;
        const busy = await tx.offerHunt.count({ where: { tenantId: c.tenantId, claimedUntil: { gt: now } } });
        if (busy > 0) return null;
        const { count } = await tx.offerHunt.updateMany({
          where: {
            id: c.id, tenantId: c.tenantId, status: 'ACTIVE', nextRunAt: { lte: now },
            OR: [{ claimedUntil: null }, { claimedUntil: { lte: now } }],
          },
          data: { claimToken: token, claimedUntil: until },
        });
        return count > 0 ? tx.offerHunt.findFirst({ where: { id: c.id, tenantId: c.tenantId } }) : null;
      });
      if (raw) claimed.push({ hunt: Mapper.huntToDomain(raw), claimToken: token });
    }
    return claimed;
  }

  async releaseClaim(tenantId: string, id: string, claimToken: string, nextRunAt: Date | null): Promise<boolean> {
    const { count } = await this.prisma.offerHunt.updateMany({
      where: { id, tenantId, claimToken },
      data: { claimToken: null, claimedUntil: null, nextRunAt },
    });
    return count > 0;
  }
}
