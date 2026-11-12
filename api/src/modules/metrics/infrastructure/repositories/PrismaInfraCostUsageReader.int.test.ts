import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../../../shared/database/prisma.client';
import { calculateInfraCosts } from '../../domain/services/infraCostCalculator';
import { defaultInfraCostSettings } from '../../domain/services/infraCostSettings';
import { PrismaInfraCostSnapshotRepository } from './PrismaInfraCostSnapshotRepository';
import { PrismaInfraCostUsageReader } from './PrismaInfraCostUsageReader';

const reader = new PrismaInfraCostUsageReader(prisma);
const snaps = new PrismaInfraCostSnapshotRepository(prisma);
const HOUR = 3_600_000;
const NOV = new Date('2026-11-01T00:00:00.000Z');
const DEC = new Date('2026-12-01T00:00:00.000Z');
const T1 = 'tenant-ic-usage-1';
const T2 = 'tenant-ic-usage-2';
const at = (h: number) => new Date(NOV.getTime() + h * HOUR);

const clean = async () => {
  await prisma.infraResourceHour.deleteMany({});
  await prisma.tenantSessionHour.deleteMany({});
  await prisma.infraUsageDaily.deleteMany({});
};

beforeAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: { in: [T1, T2] } } });
  await prisma.tenant.createMany({ data: [{ id: T1, name: 'A', slug: 'ic-usage-1' }, { id: T2, name: 'B', slug: 'ic-usage-2' }] });
});
beforeEach(clean);
afterAll(async () => {
  await clean();
  await prisma.tenant.deleteMany({ where: { id: { in: [T1, T2] } } });
  await prisma.$disconnect();
});

describe('PrismaInfraCostUsageReader', () => {
  it('mês vazio: listas vazias e uso null', async () => {
    expect(await reader.readMonth(NOV, DEC)).toEqual({ resourceHours: [], bandwidthGb: null, bandwidthHours: 0, buildMinutes: null, tenants: [] });
  });

  it('horas por recurso só dentro de [início, fim), em ordem', async () => {
    const row = (hour: Date, resourceKey: 'api' | 'worker', instances: number) => ({
      hour, resourceKey, plan: '1c-2g', instances, instancesSource: 'render' as const, diskGb: resourceKey === 'api' ? 15 : null, suspended: false,
    });
    await snaps.upsertResourceHours([
      row(new Date(NOV.getTime() - HOUR), 'api', 1),
      row(at(0), 'worker', 2),
      row(at(0), 'api', 1),
      row(at(719), 'worker', 3),
      row(DEC, 'worker', 9),
    ]);
    const r = await reader.readMonth(NOV, DEC);
    expect(r.resourceHours).toEqual([
      { hour: at(0), renderKey: 'api', plan: '1c-2g', instances: 1, diskGb: 15, suspended: false },
      { hour: at(0), renderKey: 'worker', plan: '1c-2g', instances: 2, diskGb: null, suspended: false },
      { hour: at(719), renderKey: 'worker', plan: '1c-2g', instances: 3, diskGb: null, suspended: false },
    ]);
  });

  it('banda e build somados no mês (todos os recursos), fora do mês não entra', async () => {
    await snaps.addUsageHour(at(0), { metric: 'bandwidth_gb', resourceKey: 'api', value: 4, source: 'render_metrics' });
    await snaps.addUsageHour(at(30), { metric: 'bandwidth_gb', resourceKey: 'static', value: 3, source: 'render_metrics' });
    await snaps.addUsageHour(at(0), { metric: 'bandwidth_gb', resourceKey: 'static', value: 0, source: 'render_metrics' });
    await snaps.addUsageHour(DEC, { metric: 'bandwidth_gb', resourceKey: 'api', value: 100, source: 'render_metrics' });
    await snaps.upsertUsageDay({ day: new Date('2026-11-05'), metric: 'build_minutes', resourceKey: 'api', value: 120, source: 'render_deploys' });
    await snaps.upsertUsageDay({ day: new Date('2026-10-31'), metric: 'build_minutes', resourceKey: 'api', value: 999, source: 'render_deploys' });
    const r = await reader.readMonth(NOV, DEC);
    expect(r.bandwidthGb).toBeCloseTo(7);
    // dia 1: api 1 h; dia 2: static 1 h → 2 horas com banda
    expect(r.bandwidthHours).toBe(2);
    expect(r.buildMinutes).toBe(120);
  });

  it('por tenant: sessão-hora somada, contratadas médias por hora amostrada e plano do último dia', async () => {
    await snaps.addSessionHour(at(10), [
      { tenantId: T1, planSlug: 'lite', connectedSessions: 1, contractedSessions: 1 },
      { tenantId: T2, planSlug: null, connectedSessions: 0, contractedSessions: 1 },
    ]);
    await snaps.addSessionHour(at(11), [{ tenantId: T1, planSlug: 'lite', connectedSessions: 2, contractedSessions: 1 }]);
    await snaps.addSessionHour(at(48), [{ tenantId: T1, planSlug: 'pro', connectedSessions: 3, contractedSessions: 4 }]);
    await snaps.addSessionHour(at(49), [{ tenantId: T2, planSlug: null, connectedSessions: 1, contractedSessions: 1 }]);
    await snaps.addSessionHour(DEC, [{ tenantId: T1, planSlug: 'max', connectedSessions: 50, contractedSessions: 50 }]);
    const r = await reader.readMonth(NOV, DEC);
    expect(r.tenants).toEqual([
      { tenantId: T1, planSlug: 'pro', connectedHours: 6, contractedAvg: 2 },
      { tenantId: T2, planSlug: null, connectedHours: 1, contractedAvg: 1 },
    ]);
  });

  it('alimenta o calculador: 1 → 2 instâncias no meio do mês = 37,50', async () => {
    await snaps.upsertResourceHours(
      Array.from({ length: 720 }, (_, i) => ({
        hour: at(i), resourceKey: 'worker' as const, plan: '1c-2g', instances: i < 360 ? 1 : 2, instancesSource: 'samples' as const, diskGb: null, suspended: false,
      })),
    );
    const usage = await reader.readMonth(NOV, DEC);
    const settings = defaultInfraCostSettings();
    settings.items = settings.items.filter((i) => i.key === 'worker');
    const r = calculateInfraCosts({
      settings,
      fx: null,
      live: { sessionsConnected: null, workerInstances: null, sessionsSampledAt: null },
      now: DEC,
      capacityByPlan: [],
      scaling: { maxSessionsPerWorker: 40, alertOccupancyRatio: 0.8 },
      hourly: { monthStart: NOV, monthEnd: DEC, ...usage },
    });
    expect(r.totals.total.usd).toBe(37.5);
  });
});
