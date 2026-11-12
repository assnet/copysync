import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '../../../../shared/database/prisma.client';
import { PrismaJobLease } from '../../../../shared/infrastructure/jobs/PrismaJobLease';
import type { IInfraResourcePlanReader } from '../../domain/contracts/IInfraResourcePlanReader';
import type { IFxRateSource } from '../../domain/services/fxRate';
import type { InfraRenderKey } from '../../domain/services/infraCostSettings';
import { PrismaInfraCostLiveReader } from '../repositories/PrismaInfraCostLiveReader';
import { PrismaInfraCostSettingsRepository } from '../repositories/PrismaInfraCostSettingsRepository';
import { PrismaInfraCostSnapshotRepository } from '../repositories/PrismaInfraCostSnapshotRepository';
import { INFRA_FX_FETCH_STATE_KEY, PrismaInfraFxFetchStateRepository } from '../repositories/PrismaInfraFxFetchStateRepository';
import { PrismaInfraTenantUsageReader } from '../repositories/PrismaInfraTenantUsageReader';
import { InfraCostSnapshotJob } from './InfraCostSnapshotJob';

/** Job contra Postgres local: Render e BCB falsos (nenhuma rede). */
const T = `tenant-ic-job-${Date.now()}`;
const LEASES = ['infra-cost-snapshot', 'infra-fx-rate', 'infra-cost-build', 'infra-cost-retention'];

function plans(): IInfraResourcePlanReader {
  return {
    configuredKeys: () => ['api', 'worker'] as InfraRenderKey[],
    readResource: vi.fn(async (key: InfraRenderKey) => ({
      status: 'ok' as const,
      reading: { resourceKey: key, resourceType: 'service' as const, plan: 'standard', instances: 2, diskGb: null, suspended: false },
    })),
    readBandwidthGb: vi.fn(async () => ({ status: 'ok' as const, byKey: { api: 1.25 }, discardedSeries: 0 })),
    readBuildMinutes: vi.fn(async () => ({ status: 'ok' as const, byKey: { api: 3 } })),
  };
}

function job(clock: () => Date, fxSources: IFxRateSource[]) {
  return new InfraCostSnapshotJob({
    lease: new PrismaJobLease(prisma),
    snapshots: new PrismaInfraCostSnapshotRepository(prisma),
    plans: plans(),
    live: new PrismaInfraCostLiveReader(prisma, 'srv-teste'),
    tenants: new PrismaInfraTenantUsageReader(prisma),
    settings: new PrismaInfraCostSettingsRepository(prisma),
    fxSources,
    fxState: new PrismaInfraFxFetchStateRepository(prisma),
    now: clock,
  });
}

const clean = async () => {
  await prisma.infraResourceHour.deleteMany({});
  await prisma.tenantSessionHour.deleteMany({});
  await prisma.infraFxRate.deleteMany({});
  await prisma.infraUsageDaily.deleteMany({});
  await prisma.jobLease.deleteMany({ where: { name: { in: LEASES } } });
  await prisma.platformSetting.deleteMany({ where: { key: INFRA_FX_FETCH_STATE_KEY } });
};

beforeAll(async () => {
  await prisma.tenant.create({ data: { id: T, name: 'ic-job', slug: T, planSlug: 'COPYSYNC_PRO' } });
  await prisma.session.create({
    data: { tenantId: T, name: 'ic-job', status: 'CONNECTED', ownerWorkerId: 'w1', leaseUntil: new Date(Date.now() + 3_600_000) },
  });
});
beforeEach(clean);
afterAll(async () => {
  await clean();
  await prisma.session.deleteMany({ where: { tenantId: T } });
  await prisma.tenant.deleteMany({ where: { id: T } });
  await prisma.$disconnect();
});

describe('InfraCostSnapshotJob (Postgres)', () => {
  it('dois processos na mesma hora (troca de dono) não dobram recursos, sessão-hora nem banda', async () => {
    const t0 = new Date('2026-11-12T10:02:00Z');
    const a = job(() => t0, []);
    await a.runTick();
    // A morre sem soltar o lease; B assume após o TTL e roda a mesma hora
    const b = job(() => new Date('2026-11-12T10:07:00Z'), []);
    await b.runTick();
    await b.stop();

    const hours = await prisma.infraResourceHour.findMany({ orderBy: { resourceKey: 'asc' } });
    expect(hours.map((h) => [h.hour.toISOString(), h.resourceKey, h.instances, h.instancesSource])).toEqual([
      ['2026-11-12T09:00:00.000Z', 'api', 2, 'render'],
      ['2026-11-12T09:00:00.000Z', 'worker', 2, 'render'],
    ]);
    const sh = await prisma.tenantSessionHour.findMany({ where: { tenantId: T } });
    expect(sh.map((r) => [r.connectedHours, r.contractedSessions, r.contractedSamples])).toEqual([[1, 2, 1]]);
    const bw = await prisma.infraUsageDaily.findMany({ where: { metric: 'bandwidth_gb' } });
    expect(bw.map((r) => [r.resourceKey, r.value])).toEqual([['api', 1.25]]);
    const build = await prisma.infraUsageDaily.findMany({ where: { metric: 'build_minutes' } });
    expect(build.map((r) => [r.day.toISOString().slice(0, 10), r.value])).toEqual([['2026-11-11', 3]]);
  });

  it('PTAX e SGS falhando: estado em platform_settings sobrevive a reinício; 1 nova tentativa 1 h depois', async () => {
    const failing = (name: 'ptax' | 'sgs') => ({ name, fetchLatest: vi.fn(async () => null) });
    const ptax = failing('ptax');
    const sgs = failing('sgs');
    const a = job(() => new Date('2026-11-12T16:31:00Z'), [ptax, sgs]);
    await a.runTick();
    await a.stop();
    const row = await prisma.platformSetting.findUnique({ where: { key: INFRA_FX_FETCH_STATE_KEY } });
    expect(row?.value).toEqual({ referenceDay: '2026-11-12', attempts: 1, lastAttemptAt: '2026-11-12T16:31:00.000Z', ok: false });

    let now = new Date('2026-11-12T17:00:00Z');
    const b = job(() => now, [ptax, sgs]);
    await b.runTick();
    expect(ptax.fetchLatest).toHaveBeenCalledTimes(1);
    now = new Date('2026-11-12T17:32:00Z');
    await b.runTick();
    expect(sgs.fetchLatest).toHaveBeenCalledTimes(2);
    now = new Date('2026-11-12T19:00:00Z');
    await b.runTick();
    await b.stop();
    expect(ptax.fetchLatest).toHaveBeenCalledTimes(2);
    expect(await prisma.infraFxRate.count()).toBe(0);
    expect(await new PrismaInfraFxFetchStateRepository(prisma).get()).toMatchObject({ attempts: 2, ok: false });
  });

  it('PTAX ok: grava infra_fx_rates e marca o dia', async () => {
    const ptax = { name: 'ptax' as const, fetchLatest: vi.fn(async () => ({ rate: 5.4321, referenceDate: '2026-11-12', source: 'ptax' as const })) };
    const j = job(() => new Date('2026-11-12T16:40:00Z'), [ptax]);
    await j.runTick();
    await j.stop();
    const saved = await new PrismaInfraCostSnapshotRepository(prisma).latestFxRate(new Date('2026-11-12T00:00:00Z'));
    expect(saved).toMatchObject({ rate: 5.4321, source: 'ptax', referenceDate: new Date('2026-11-12T00:00:00Z') });
    expect(await new PrismaInfraFxFetchStateRepository(prisma).get()).toMatchObject({ attempts: 1, ok: true });
  });
});
