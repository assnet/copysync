import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { prisma } from '../../../../shared/database/prisma.client';
import type { InfraResourceHourSnapshot } from '../../domain/contracts/IInfraCostSnapshotRepository';
import { PrismaInfraCostSnapshotRepository } from './PrismaInfraCostSnapshotRepository';

const repo = new PrismaInfraCostSnapshotRepository(prisma);
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const h10 = new Date('2026-11-12T10:00:00.000Z');
const T1 = 'tenant-ic-snap-1';
const T2 = 'tenant-ic-snap-2';

const resource = (over: Partial<InfraResourceHourSnapshot> = {}): InfraResourceHourSnapshot => ({
  hour: h10, resourceKey: 'api', plan: 'starter', instances: 1, instancesSource: 'render', diskGb: null, suspended: false, ...over,
});

const clean = async () => {
  await prisma.infraResourceHour.deleteMany({});
  await prisma.tenantSessionHour.deleteMany({});
  await prisma.infraFxRate.deleteMany({});
  await prisma.infraUsageDaily.deleteMany({});
};

beforeAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: { in: [T1, T2] } } });
  await prisma.tenant.createMany({ data: [{ id: T1, name: 'A', slug: 'ic-snap-1' }, { id: T2, name: 'B', slug: 'ic-snap-2' }] });
});
beforeEach(clean);
afterAll(async () => {
  await clean();
  await prisma.tenant.deleteMany({ where: { id: { in: [T1, T2] } } });
  await prisma.$disconnect();
});

describe('PrismaInfraCostSnapshotRepository', () => {
  it('gravar a mesma hora duas vezes não dobra: upsert regrava por (hour, resourceKey)', async () => {
    expect(await repo.hasResourceHour(h10)).toBe(false);
    expect(await repo.upsertResourceHours([])).toBe(0);
    await repo.upsertResourceHours([resource(), resource({ resourceKey: 'worker', instances: 2, instancesSource: 'samples' })]);
    await repo.upsertResourceHours([resource({ hour: new Date(h10.getTime() + 25 * 60_000), instances: 3, diskGb: 10 })]);
    expect(await repo.hasResourceHour(new Date(h10.getTime() + 59 * 60_000))).toBe(true);
    const rows = await prisma.infraResourceHour.findMany({ orderBy: { resourceKey: 'asc' } });
    expect(rows.map((r) => [r.hour.toISOString(), r.resourceKey, r.instances, r.diskGb])).toEqual([
      [h10.toISOString(), 'api', 3, 10],
      [h10.toISOString(), 'worker', 2, null],
    ]);
  });

  it('CHECK recusa resourceKey desconhecido', async () => {
    await expect(repo.upsertResourceHours([resource({ resourceKey: 'srv-teste' as never })])).rejects.toThrow();
  });

  it('sessão-hora soma uma vez por hora e acumula horas diferentes no dia', async () => {
    const s = [
      { tenantId: T1, planSlug: 'pro', connectedSessions: 2, contractedSessions: 3 },
      { tenantId: T2, planSlug: null, connectedSessions: 0, contractedSessions: 1 },
    ];
    expect(await repo.addSessionHour(h10, s)).toBe(2);
    expect(await repo.addSessionHour(new Date(h10.getTime() + 10 * 60_000), s)).toBe(0);
    expect(await repo.addSessionHour(new Date(h10.getTime() - HOUR), s)).toBe(0);
    expect(await repo.addSessionHour(new Date(h10.getTime() + HOUR), [{ ...s[0]!, planSlug: 'max', connectedSessions: 1 }])).toBe(1);
    const row = await prisma.tenantSessionHour.findUniqueOrThrow({ where: { day_tenantId: { day: new Date('2026-11-12'), tenantId: T1 } } });
    expect(row).toMatchObject({ planSlug: 'max', connectedHours: 3, contractedSessions: 6, contractedSamples: 2 });
    expect(row.lastHour.toISOString()).toBe(new Date(h10.getTime() + HOUR).toISOString());
  });

  it('virada do dia UTC abre linha nova; tenant repetido no lote é somado', async () => {
    await repo.addSessionHour(new Date('2026-11-12T23:00:00.000Z'), [
      { tenantId: T1, planSlug: 'pro', connectedSessions: 1, contractedSessions: 1 },
      { tenantId: T1, planSlug: null, connectedSessions: 2, contractedSessions: 2 },
    ]);
    await repo.addSessionHour(new Date('2026-11-13T00:00:00.000Z'), [{ tenantId: T1, planSlug: 'pro', connectedSessions: 4, contractedSessions: 1 }]);
    const rows = await prisma.tenantSessionHour.findMany({ where: { tenantId: T1 }, orderBy: { day: 'asc' } });
    expect(rows.map((r) => [r.day.toISOString().slice(0, 10), r.connectedHours, r.contractedSessions, r.contractedSamples, r.planSlug])).toEqual([
      ['2026-11-12', 3, 3, 1, 'pro'],
      ['2026-11-13', 4, 1, 1, 'pro'],
    ]);
  });

  it('dois processos na mesma hora somam uma vez', async () => {
    const other = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
    try {
      const repo2 = new PrismaInfraCostSnapshotRepository(other);
      const s = [{ tenantId: T1, planSlug: 'pro', connectedSessions: 2, contractedSessions: 3 }];
      await repo.addSessionHour(new Date(h10.getTime() - HOUR), s);
      for (let i = 0; i < 5; i++) {
        const at = new Date(h10.getTime() + i * HOUR);
        const [a, b] = await Promise.all([repo.addSessionHour(at, s), repo2.addSessionHour(at, s)]);
        expect(a + b).toBe(1);
        const [ua, ub] = await Promise.all([
          repo.addUsageHour(at, { metric: 'bandwidth_gb', resourceKey: 'static', value: 0.5, source: 'render_metrics' }),
          repo2.addUsageHour(at, { metric: 'bandwidth_gb', resourceKey: 'static', value: 0.5, source: 'render_metrics' }),
        ]);
        expect(Number(ua) + Number(ub)).toBe(1);
      }
      const row = await prisma.tenantSessionHour.findFirstOrThrow({ where: { tenantId: T1 } });
      expect(row).toMatchObject({ connectedHours: 12, contractedSessions: 18, contractedSamples: 6 });
      const band = await prisma.infraUsageDaily.findFirstOrThrow({ where: { metric: 'bandwidth_gb' } });
      expect(band.value).toBeCloseTo(2.5);
    } finally {
      await other.$disconnect();
    }
  });

  it('banda soma por hora com guarda; build regrava o dia', async () => {
    const band = { metric: 'bandwidth_gb', resourceKey: 'api', value: 1.25, source: 'render_metrics' } as const;
    expect(await repo.addUsageHour(h10, band)).toBe(true);
    expect(await repo.addUsageHour(h10, band)).toBe(false);
    expect(await repo.addUsageHour(new Date(h10.getTime() + HOUR), { ...band, value: 0.75 })).toBe(true);
    const day = new Date('2026-11-12T00:00:00.000Z');
    const build = { day, metric: 'build_minutes', resourceKey: 'worker', source: 'render_deploys' } as const;
    await repo.upsertUsageDay({ ...build, value: 12 });
    await repo.upsertUsageDay({ ...build, value: 7 });
    const rows = await prisma.infraUsageDaily.findMany({ orderBy: { metric: 'asc' } });
    expect(rows.map((r) => [r.metric, r.resourceKey, r.value, r.lastHour?.toISOString() ?? null])).toEqual([
      ['bandwidth_gb', 'api', 2, new Date(h10.getTime() + HOUR).toISOString()],
      ['build_minutes', 'worker', 7, null],
    ]);
  });

  it('cotação: upsert por dia e a mais recente até a data', async () => {
    const at = new Date('2026-11-12T19:00:00.000Z');
    expect(await repo.latestFxRate(at)).toBeNull();
    await repo.upsertFxRate({ referenceDate: new Date('2026-11-10'), rate: 5.4321, source: 'ptax', fetchedAt: at });
    await repo.upsertFxRate({ referenceDate: new Date('2026-11-11'), rate: 5.1, source: 'ptax', fetchedAt: at });
    await repo.upsertFxRate({ referenceDate: new Date('2026-11-11'), rate: 5.12345, source: 'sgs', fetchedAt: at });
    await repo.upsertFxRate({ referenceDate: new Date('2026-11-13'), rate: 6, source: 'ptax', fetchedAt: at });
    expect(await repo.latestFxRate(at)).toEqual({ referenceDate: new Date('2026-11-11'), rate: 5.1235, source: 'sgs', fetchedAt: at });
    expect((await repo.latestFxRate(new Date('2026-11-10')))?.rate).toBe(5.4321);
  });

  it('limpeza por lote: apaga o que passou do corte nas quatro tabelas, com teto de lotes', async () => {
    const cutoff = new Date(h10.getTime() - 400 * DAY);
    const old = Array.from({ length: 5 }, (_, i) => resource({ hour: new Date(cutoff.getTime() - (i + 1) * HOUR) }));
    await repo.upsertResourceHours(old);
    await repo.upsertResourceHours([resource({ hour: cutoff }), resource({ hour: h10 })]);
    await repo.addSessionHour(new Date(cutoff.getTime() - DAY), [{ tenantId: T1, planSlug: null, connectedSessions: 1, contractedSessions: 1 }]);
    await repo.addSessionHour(h10, [{ tenantId: T1, planSlug: null, connectedSessions: 1, contractedSessions: 1 }]);
    await repo.upsertFxRate({ referenceDate: new Date(cutoff.getTime() - DAY), rate: 5, source: 'ptax', fetchedAt: h10 });
    await repo.addUsageHour(new Date(cutoff.getTime() - DAY), { metric: 'bandwidth_gb', resourceKey: 'api', value: 1, source: 'render_metrics' });

    const small = new PrismaInfraCostSnapshotRepository(prisma, { retentionBatchSize: 2, retentionMaxBatches: 2 });
    expect(await small.deleteOlderThan(cutoff)).toEqual({ resourceHours: 4, sessionHours: 1, fxRates: 1, usageDaily: 1 });
    expect(await small.deleteOlderThan(cutoff)).toEqual({ resourceHours: 1, sessionHours: 0, fxRates: 0, usageDaily: 0 });
    expect(await prisma.infraResourceHour.count()).toBe(2);
    expect(await prisma.tenantSessionHour.count()).toBe(1);
    expect(await prisma.infraFxRate.count()).toBe(0);
    expect(await prisma.infraUsageDaily.count()).toBe(0);
  });

  it('apagar o tenant apaga a sessão-hora (cascade) e o índice (tenantId, day) existe', async () => {
    await prisma.tenant.create({ data: { id: 'tenant-ic-snap-tmp', name: 'C', slug: 'ic-snap-tmp' } });
    await repo.addSessionHour(h10, [{ tenantId: 'tenant-ic-snap-tmp', planSlug: null, connectedSessions: 1, contractedSessions: 1 }]);
    await prisma.tenant.delete({ where: { id: 'tenant-ic-snap-tmp' } });
    expect(await prisma.tenantSessionHour.count()).toBe(0);
    const idx = await prisma.$queryRaw<{ indexdef: string }[]>`
      SELECT indexdef FROM pg_indexes WHERE tablename = 'tenant_session_hours' AND indexname = 'tenant_session_hours_tenantId_day_idx'`;
    expect(idx[0]?.indexdef).toContain('("tenantId", day)');
  });
});
