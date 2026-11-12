import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../../../shared/database/prisma.client';
import { CloseInfraCostMonthUseCase } from '../../application/use-cases/CloseInfraCostMonthUseCase';
import { defaultInfraCostSettings } from '../../domain/services/infraCostSettings';
import { PrismaInfraCostReportReader } from './PrismaInfraCostReportReader';
import { PrismaInfraCostSnapshotRepository } from './PrismaInfraCostSnapshotRepository';
import { PrismaInfraCostUsageReader } from './PrismaInfraCostUsageReader';

/** Abas Por cliente e Histórico (COST-14/15) contra Postgres local. */
const HOUR = 3_600_000;
const OCT = new Date('2026-10-01T00:00:00.000Z');
const NOV = new Date('2026-11-01T00:00:00.000Z');
const IDS = ['tenant-ic-rep-a', 'tenant-ic-rep-b', 'tenant-ic-rep-c'] as const;
const [A, B, C] = IDS;
const at = (h: number) => new Date(OCT.getTime() + h * HOUR);

const repo = new PrismaInfraCostSnapshotRepository(prisma);
const reader = new PrismaInfraCostReportReader(prisma);

const clean = async () => {
  await prisma.infraCostMonth.deleteMany({});
  await prisma.infraResourceHour.deleteMany({});
  await prisma.tenantSessionHour.deleteMany({});
  await prisma.aiUsageLog.deleteMany({ where: { tenantId: { in: [...IDS] } } });
};

beforeAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: { in: [...IDS] } } });
  await prisma.tenant.createMany({
    data: IDS.map((id, i) => ({ id, name: `Cliente ${i}`, slug: `ic-rep-${i}`, planSlug: 'COPYSYNC_LITE' })),
  });
});
beforeEach(async () => {
  await clean();
  await repo.upsertResourceHours([{ hour: at(0), resourceKey: 'api', plan: '1c-2g', instances: 1, instancesSource: 'render', diskGb: 15, suspended: false }]);
  for (const h of [0, 1]) {
    await repo.addSessionHour(at(h), [
      { tenantId: C, planSlug: 'COPYSYNC_PRO', connectedSessions: 1, contractedSessions: 3 },
      { tenantId: B, planSlug: 'COPYSYNC_PRO', connectedSessions: 2, contractedSessions: 3 },
      { tenantId: A, planSlug: 'COPYSYNC_LITE', connectedSessions: 1, contractedSessions: 1 },
    ]);
  }
  await prisma.aiUsageLog.createMany({
    data: [
      { tenantId: B, createdAt: at(5), source: 'PLATFORM', kind: 'OPENAI', model: 'gpt-x', purpose: 'teste', inputTokens: 1_000_000, outputTokens: 0, success: true },
      { tenantId: A, createdAt: at(5), source: 'PLATFORM', kind: 'OPENAI', model: 'gpt-x', purpose: 'teste', inputTokens: 500_000, outputTokens: 0, success: true },
    ],
  });
});
afterAll(async () => {
  await clean();
  await prisma.tenant.deleteMany({ where: { id: { in: [...IDS] } } });
});

describe('PrismaInfraCostReportReader', () => {
  it('mês aberto: nome (sem caixa) + tenantId, plano do último dia (qualificado), keyset e IA só da página', async () => {
    const all = await reader.pageOpenMonth(OCT, NOV, { limit: 10 });
    expect(all.rows.map((r) => r.tenantId)).toEqual([A, B, C]);
    expect(all.rows[1]).toEqual({ tenantId: B, tenantName: 'Cliente 1', sortKey: 'cliente 1', planSlug: 'COPYSYNC_PRO', connectedHours: 4, contractedAvg: 3 });

    const pro1 = await reader.pageOpenMonth(OCT, NOV, { planSlug: 'COPYSYNC_PRO', limit: 1 });
    expect(pro1.rows.map((r) => r.tenantId)).toEqual([B]);
    expect(pro1.aiUsage.map((r) => r.tenantId)).toEqual([B]);
    expect(pro1.aiUsage[0]).toMatchObject({ calls: 1, inputTokens: 1_000_000, missingTokenCalls: 0 });
    // Uso muda entre as páginas (C passa B): a ordem por nome não muda, nada pula nem repete
    await repo.addSessionHour(at(2), [{ tenantId: C, planSlug: 'COPYSYNC_PRO', connectedSessions: 9, contractedSessions: 30 }]);
    const pro2 = await reader.pageOpenMonth(OCT, NOV, { planSlug: 'COPYSYNC_PRO', after: { sortKey: pro1.rows[0].sortKey, tenantId: B }, limit: 1 });
    expect(pro2.rows.map((r) => r.tenantId)).toEqual([C]);
    expect(pro2.aiUsage).toEqual([]);
    const end = await reader.pageOpenMonth(OCT, NOV, { planSlug: 'COPYSYNC_PRO', after: { sortKey: pro2.rows[0].sortKey, tenantId: C }, limit: 1 });
    expect(end.rows).toEqual([]);

    expect((await reader.pageOpenMonth(NOV, new Date('2026-12-01T00:00:00Z'), { limit: 10 })).rows).toEqual([]);
  });

  it('mês aberto: nome igual desempata pelo tenantId', async () => {
    await prisma.tenant.update({ where: { id: B }, data: { name: 'cliente 0' } });
    try {
      const p1 = await reader.pageOpenMonth(OCT, NOV, { limit: 1 });
      expect(p1.rows.map((r) => r.tenantId)).toEqual([A]);
      const p2 = await reader.pageOpenMonth(OCT, NOV, { after: { sortKey: p1.rows[0].sortKey, tenantId: A }, limit: 1 });
      expect(p2.rows.map((r) => r.tenantId)).toEqual([B]);
    } finally {
      await prisma.tenant.update({ where: { id: B }, data: { name: 'Cliente 1' } });
    }
  });

  it('mês fechado: total congelado desc + tenantId e histórico por plano', async () => {
    const settings = defaultInfraCostSettings();
    settings.fx.override = { rate: 5, date: '2026-10-31' };
    settings.aiModelPrices = [{ kind: 'OPENAI', model: 'gpt-x', inputPerMTokUsd: 2, outputPerMTokUsd: 8 }];
    const closed = await new CloseInfraCostMonthUseCase({
      months: repo,
      fxRates: repo,
      settings: { get: async () => ({ value: settings, updatedAt: new Date(0), updatedById: null }), save: async () => { throw new Error('não usado'); } },
      usage: new PrismaInfraCostUsageReader(prisma),
      scaling: { current: () => ({ value: { maxSessionsPerWorker: 100, alertOccupancyRatio: 0.8 } }) } as never,
    }).execute({ month: '2026-10', now: new Date('2026-11-01T01:05:00Z') });
    expect(closed).toBe('closed');

    const rows = await reader.pageClosedMonth(OCT, { limit: 10 });
    expect(rows.map((r) => r.tenantId)).toEqual([B, C, A]);
    // Keyset em `totalUsd desc, tenantId`: B e C empatam no compartilhado, a IA de B desempata
    const p1 = await reader.pageClosedMonth(OCT, { limit: 1 });
    const p2 = await reader.pageClosedMonth(OCT, { after: { sortKey: p1[0].sortKey, tenantId: p1[0].tenantId }, limit: 1 });
    const p3 = await reader.pageClosedMonth(OCT, { after: { sortKey: p2[0].sortKey, tenantId: p2[0].tenantId }, limit: 5 });
    expect([...p1, ...p2, ...p3].map((r) => r.tenantId)).toEqual([B, C, A]);
    expect(rows[0].totalUsd).toBeCloseTo(rows[0].sharedUsd + 2, 4);
    expect(rows[0]).toMatchObject({ tenantName: 'Cliente 1', planSlug: 'COPYSYNC_PRO', aiUsd: 2, sessionHours: 4 });
    expect((await reader.pageClosedMonth(OCT, { planSlug: 'COPYSYNC_LITE', limit: 10 })).map((r) => r.tenantId)).toEqual([A]);

    const history = await reader.listClosedMonths(new Date('2025-11-01T00:00:00Z'), NOV);
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      closingMethod: settings.fx.closingMethod,
      fx: { rate: 5, source: 'override' },
      totalIsPartial: expect.any(Boolean),
      unallocatedUsd: 0,
      excludedUsd: expect.any(Number),
    });
    expect(history[0].month.toISOString()).toBe(OCT.toISOString());
    const byPlan = Object.fromEntries(history[0].plans.map((p) => [p.planSlug, p]));
    expect(byPlan.COPYSYNC_PRO).toMatchObject({ tenants: 2, aiUsd: 2 });
    expect(byPlan.COPYSYNC_LITE).toMatchObject({ tenants: 1, aiUsd: 1 });
    const sumPlans = history[0].plans.reduce((s, p) => s + p.sharedUsd, 0);
    expect(sumPlans).toBeLessThanOrEqual(history[0].totalUsd);
    expect(await reader.listClosedMonths(NOV, new Date('2026-12-01T00:00:00Z'))).toEqual([]);
  });

  it('mês fechado: empate no total desempata pelo tenantId no keyset (nada pula nem repete)', async () => {
    const t = (tenantId: string, totalUsd: number) =>
      ({ tenantId, planSlug: 'COPYSYNC_PRO', contractedAvg: 1, sessionHours: 1, sharedUsd: totalUsd, aiUsd: 0, totalUsd });
    expect(await repo.saveClosedMonth({
      month: OCT, closingMethod: 'last_business_day', fx: null, totalUsd: 30, totals: {}, tenants: [t(C, 10), t(A, 10), t(B, 10)],
    })).toBe(true);
    const seen: string[] = [];
    let after: { sortKey: string; tenantId: string } | undefined;
    for (let i = 0; i < 4; i++) {
      const page = await reader.pageClosedMonth(OCT, { after, limit: 1 });
      if (page.length === 0) break;
      seen.push(page[0].tenantId);
      after = { sortKey: page[0].sortKey, tenantId: page[0].tenantId };
    }
    expect(seen).toEqual([A, B, C].sort());
    const [history] = await reader.listClosedMonths(OCT, NOV);
    expect(history).toMatchObject({ unallocatedUsd: 0, excludedUsd: 0 }); // JSON sem `allocation` = 0
  });
});
