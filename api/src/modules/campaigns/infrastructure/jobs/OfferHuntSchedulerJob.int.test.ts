import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { prisma } from '../../../../shared/database/prisma.client';
import { PrismaJobLease } from '../../../../shared/infrastructure/jobs/PrismaJobLease';
import { PrismaOfferHuntRepository } from '../repositories/hunter/PrismaOfferHuntRepository';
import type { CreateOfferHuntInput } from '../../domain/contracts/hunter/IOfferHuntRepository';
import type { RunOfferHuntInput, RunOfferHuntOutput } from '../../application/use-cases/hunter/RunOfferHuntUseCase';
import { OFFER_HUNT_SCHEDULER_LEASE, OfferHuntSchedulerJob } from './OfferHuntSchedulerJob';

/** Dois "processos" (2 pools, 2 jobs) no mesmo tique: cada caçada roda uma vez só; caçador falso (sem Shein). */
const other = new PrismaClient({ datasources: { db: { url: process.env['DATABASE_URL']! } } });
const stamp = Date.now();
const tenants: string[] = [];
// 13:00 em São Paulo
const NOW = new Date('2026-11-12T16:00:00.000Z');

const def = (tenantId: string, nextRunAt: Date): CreateOfferHuntInput => ({
  tenantId, name: 'job', sort: 'BEST_SELLING', categoryId: null, commissionBand: null, keyword: null, filters: {},
  aiEnabled: false, topN: 3, repeatAfterDays: 7, deliveryMode: 'REVIEW', intervalMinutes: 60, windowStartMinute: 0,
  windowEndMinute: 1440, weekdaysMask: 127, nextRunAt,
});

const output = (): RunOfferHuntOutput => ({
  runId: 'r', status: 'SUCCEEDED', errorCode: null, seenCount: 0, matchedCount: 0, chosenCount: 0, sentCount: 0,
  aiUsed: false, aiFallback: false, ranking: [], finds: [], remainingToday: 5, pausedReason: null,
});

function processJob(client: PrismaClient, calls: RunOfferHuntInput[], perTick: number) {
  const execute = vi.fn(async (i: RunOfferHuntInput) => {
    calls.push(i);
    await new Promise((r) => setTimeout(r, 30));
    return output();
  });
  return new OfferHuntSchedulerJob({
    lease: new PrismaJobLease(client),
    hunts: new PrismaOfferHuntRepository(client),
    run: () => ({ execute }),
    perTick,
    now: () => NOW,
    sleep: async () => undefined,
  });
}

beforeAll(async () => {
  await other.$connect();
  await prisma.jobLease.deleteMany({ where: { name: OFFER_HUNT_SCHEDULER_LEASE } });
});
afterAll(async () => {
  await prisma.jobLease.deleteMany({ where: { name: OFFER_HUNT_SCHEDULER_LEASE } });
  await prisma.tenant.deleteMany({ where: { id: { in: tenants } } });
  await other.$disconnect();
  await prisma.$disconnect();
});

describe('OfferHuntSchedulerJob (Postgres)', () => {
  it('dois processos no mesmo tique: cada caçada vencida roda uma vez e volta agendada sem posse', async () => {
    const repo = new PrismaOfferHuntRepository(prisma);
    const ids: string[] = [];
    for (const tag of ['a', 'b']) {
      const t = (await prisma.tenant.create({ data: { name: `int hunt job ${tag}`, slug: `int-hunt-job-${tag}-${stamp}` } })).id;
      tenants.push(t);
      ids.push((await repo.createWithinLimit(def(t, new Date('2026-11-12T15:00:00.000Z')), 5))!.id);
    }
    const calls: RunOfferHuntInput[] = [];
    // Lease global + posse CAS: quem pegar o tique roda; o outro sai sem lease ou não acha nada vencido
    await Promise.all([processJob(prisma, calls, 10).runTick(), processJob(other, calls, 10).runTick()]);
    const ours = calls.filter((c) => tenants.includes(c.tenantId));
    expect(ours.map((c) => c.huntId).sort()).toEqual([...ids].sort());
    expect(ours.every((c) => c.trigger === 'SCHEDULED')).toBe(true);

    const rows = await prisma.offerHunt.findMany({ where: { id: { in: ids } } });
    for (const r of rows) {
      expect(r.claimToken).toBeNull();
      expect(r.claimedUntil).toBeNull();
      expect(r.nextRunAt).toEqual(new Date('2026-11-12T17:00:00.000Z'));
    }
    expect(await prisma.jobLease.count({ where: { name: OFFER_HUNT_SCHEDULER_LEASE } })).toBe(0);

    // Novo tique dos dois: nada vencido (próxima às 17:00), ninguém roda de novo
    await Promise.all([processJob(prisma, calls, 10).runTick(), processJob(other, calls, 10).runTick()]);
    expect(calls.filter((c) => tenants.includes(c.tenantId))).toHaveLength(2);
  });
});
