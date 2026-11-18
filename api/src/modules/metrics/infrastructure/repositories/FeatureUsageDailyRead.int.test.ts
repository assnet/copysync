import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../../../../shared/database/prisma.client';
import { RollupFeatureUsageUseCase } from '../../application/use-cases/RollupFeatureUsageUseCase';
import { type FeatureUsageDeps, type FeatureUsageQueryInput, GetFeatureUsageSummaryUseCase } from '../../application/use-cases/GetFeatureUsageSummaryUseCase';
import type { FeatureUsageRollupState } from '../../domain/contracts/IFeatureUsageRollupStateRepository';
import { FEATURE_USAGE_CATALOG } from '../../domain/services/featureUsageCatalog';
import { startOfDayInstant } from '../../domain/services/featureUsagePeriod';
import { PrismaDailyFeatureUsageReader } from './PrismaDailyFeatureUsageReader';
import { PrismaFeatureUsageDailyRepository } from './PrismaFeatureUsageDailyRepository';
import { FEATURE_USAGE_ROLLUP_SETTINGS_KEY, PrismaFeatureUsageRollupStateRepository } from './PrismaFeatureUsageRollupStateRepository';
import { FEATURE_USAGE_SOURCES, PrismaLiveFeatureUsageReader } from './PrismaLiveFeatureUsageReader';
import { PrismaUsageTenantDirectory } from './PrismaUsageTenantDirectory';
import { createReadBudget, usageReadGate } from './featureUsageReadTimeout';

/**
 * Leitura pelo agregado (T22) contra o Postgres descartável, banco em `America/Sao_Paulo` (≠ UTC):
 * mesma resposta do sob demanda depois do rollup, buckets de semana que não misturam período atual e anterior, e
 * o pior caso de volume (19 contas × 18 pares × 800 dias = 274 mil linhas) dentro da guarda e do orçamento.
 */
const s = `fdr${Date.now().toString(36)}`;
const A = `${s}-ta`;
const B = `${s}-tb`;
const C = `${s}-tc`;
const BULK = Array.from({ length: 19 }, (_, i) => `${s}-bulk${String(i).padStart(2, '0')}`);
let dbName = '';
let n = 0;
const id = (p: string) => `${s}-${p}${n++}`;
const run = (sql: string) => prisma.$executeRawUnsafe(sql);
const tenant = (t: string) => run(`INSERT INTO tenants (id, name, slug, "updatedAt") VALUES ('${t}', 'x', '${t}', now())`);
const offer = (t: string, origin: string, at: string) =>
  run(`INSERT INTO offers (id, "tenantId", provider, "sourceUrl", "affiliateUrl", text, origin, "createdAt", "updatedAt")
    VALUES ('${id('o')}', '${t}', 'SHOPEE', 'x', 'x', 'x', '${origin}', '${at}', now())`);
const huntRun = (t: string, trigger: string, at: string) =>
  run(`INSERT INTO offer_hunt_runs (id, "tenantId", trigger, status, "startedAt") VALUES ('${id('h')}', '${t}', '${trigger}', 'SUCCEEDED', '${at}')`);
const ai = (t: string, purpose: string, at: string) =>
  run(`INSERT INTO ai_usage_logs (id, "tenantId", source, kind, model, purpose, success, "createdAt")
    VALUES ('${id('ai')}', '${t}', 'PLATFORM', 'OPENAI', 'm', '${purpose}', true, '${at}')`);
const session = (t: string, engine: string, at: string) =>
  run(`INSERT INTO sessions (id, "tenantId", name, engine, "createdAt", "updatedAt") VALUES ('${id('s')}', '${t}', 'x', '${engine}', '${at}', now())`);

const clearMarker = () => prisma.platformSetting.deleteMany({ where: { key: FEATURE_USAGE_ROLLUP_SETTINGS_KEY } });
const NO_MARKER: FeatureUsageRollupState = { backfillCompletedAt: null, backfilledFrom: null, backfillStopReason: null, backfillCursor: null, cutovers: {}, lastSuccessAt: null, finalizedThrough: null, failureStreak: 0 };
const marker = (backfilledFrom: string) => ({
  get: async (): Promise<FeatureUsageRollupState> => ({ backfillCompletedAt: new Date('2026-01-01T00:00:00Z'), backfilledFrom, backfillStopReason: 'RETENTION', backfillCursor: null, cutovers: {}, lastSuccessAt: new Date(), finalizedThrough: null, failureStreak: 0 }),
});

function deps(now: Date, rollupState: FeatureUsageDeps['rollupState']): FeatureUsageDeps {
  return {
    reader: new PrismaLiveFeatureUsageReader(prisma),
    dailyReader: new PrismaDailyFeatureUsageReader(prisma),
    rollupState,
    directory: new PrismaUsageTenantDirectory(prisma),
    gate: usageReadGate,
    now: () => now,
  };
}
const query = (from: string, to: string, over: Partial<FeatureUsageQueryInput> = {}): FeatureUsageQueryInput => ({
  from, to, granularity: 'day', kinds: [], tenantStatus: 'ALL', includeInternal: true, ...over,
});

beforeAll(async () => {
  dbName = (await prisma.$queryRaw<{ d: string }[]>`SELECT current_database() AS d`)[0]!.d;
  await prisma.$executeRawUnsafe(`ALTER DATABASE "${dbName}" SET timezone = 'America/Sao_Paulo'`);
  await prisma.$disconnect();
  await clearMarker();
  for (const t of [A, B, C, ...BULK]) await tenant(t);
});

afterAll(async () => {
  await clearMarker();
  await run(`DELETE FROM tenants WHERE id LIKE '${s}-%'`);
  await prisma.$executeRawUnsafe(`ALTER DATABASE "${dbName}" SET timezone = 'UTC'`);
  await prisma.$disconnect();
});

describe('leitura pelo agregado', () => {
  it('sem marco cai em live com linhas no agregado; depois do backfill, live e daily dão os mesmos números', async () => {
    // Maio e junho de 2026; 02:30 UTC do dia 3 é 23:30 do dia 2 em Brasília
    await offer(A, 'GENERATOR', '2026-06-02 15:00:00');
    await offer(A, 'GENERATOR', '2026-06-03 02:30:00');
    await offer(B, 'GENERATOR', '2026-06-10 12:00:00');
    await offer(B, 'MONITORING', '2026-06-11 12:00:00');
    await offer(A, 'MONITORING', '2026-05-20 12:00:00');
    await huntRun(A, 'MANUAL', '2026-06-15 12:00:00');
    await huntRun(A, 'SCHEDULED', '2026-06-15 13:00:00');
    await huntRun(B, 'SCHEDULED', '2026-05-25 13:00:00');
    await ai(A, 'offer.text', '2026-06-20 12:00:00');
    await ai(B, 'offer_story_headline', '2026-06-21 12:00:00');
    await session(B, 'baileys', '2026-06-22 12:00:00');
    await session(A, 'telegram', '2026-05-28 12:00:00');

    const now = new Date('2026-06-30T15:00:00Z');
    const state = new PrismaFeatureUsageRollupStateRepository(prisma);
    const rollup = new RollupFeatureUsageUseCase({
      reader: new PrismaLiveFeatureUsageReader(prisma),
      daily: new PrismaFeatureUsageDailyRepository(prisma),
      state,
      lease: { tryAcquire: async () => true, renew: async () => true, release: async () => undefined },
      newBudget: () => createReadBudget(10_000),
      sourceGroups: FEATURE_USAGE_SOURCES.map((x) => x.keys),
      now: () => now,
    });
    await rollup.execute();
    expect((await state.get()).backfillCompletedAt).toBeNull();
    const rowsSoFar = await prisma.$queryRawUnsafe<{ c: number }[]>(
      `SELECT count(*)::int AS c FROM feature_usage_daily WHERE "tenantId" IN ('${A}', '${B}')`,
    );
    expect(rowsSoFar[0]!.c).toBeGreaterThan(0);
    const q = query('2026-06-01', '2026-06-30');
    expect((await new GetFeatureUsageSummaryUseCase(deps(now, state)).execute(q)).source).toBe('live');

    for (let i = 0; i < 80 && !(await state.get()).backfillCompletedAt; i++) await rollup.execute();
    const done = await state.get();
    expect(done.backfilledFrom! <= '2026-05-20').toBe(true);

    for (const granularity of ['day', 'week'] as const) {
      const qq = { ...q, granularity };
      const live = await new GetFeatureUsageSummaryUseCase(deps(now, { get: async () => NO_MARKER })).execute(qq);
      const daily = await new GetFeatureUsageSummaryUseCase(deps(now, state)).execute(qq);
      expect(live.source).toBe('live');
      expect(daily.source).toBe('daily');
      expect(daily.range.maxDays).toBe(400);
      const numbers = (out: typeof live) => ({
        totals: out.totals.activeTenants,
        series: out.series,
        features: out.features.map((f) => ({ k: f.key, u: f.uses, t: f.activeTenants, kind: f.byKind, plan: f.byPlan, last: f.lastUsedDay })),
      });
      expect(numbers(daily)).toEqual(numbers(live));
      expect(daily.features.find((f) => f.key === 'offer_generator')).toMatchObject({ uses: 3, activeTenants: 2 });
    }
  }, 120_000);

  it('semana que cruza o início do período: anterior e atual em linhas separadas, contadas no lado certo', async () => {
    const repo = new PrismaFeatureUsageDailyRepository(prisma);
    // 2026-03-02 é segunda: o dia 2 fica no anterior e o dia 5 no atual (período começa na quarta, 2026-03-04)
    for (const at of ['2025-11-01T15:00:00Z', '2026-03-02T15:00:00Z', '2026-03-05T15:00:00Z']) {
      await repo.increment({ tenantId: C, featureKey: 'offer_generator', kind: 'ACTION', at: new Date(at) });
    }
    const reader = new PrismaDailyFeatureUsageReader(prisma);
    const window = { from: startOfDayInstant('2025-11-05'), toExclusive: startOfDayInstant('2026-07-01'), featureKeys: ['offer_generator' as const], granularity: 'week' as const };
    const mixed = (await reader.read({ ...window, budget: createReadBudget() })).rows.filter((r) => r.tenantId === C);
    expect(mixed.map((r) => [r.day, r.uses, r.lastDay])).toEqual([['2026-03-02', 2, '2026-03-05']]);
    const split = (await reader.read({ ...window, currentFrom: startOfDayInstant('2026-03-04'), budget: createReadBudget() })).rows
      .filter((r) => r.tenantId === C)
      .sort((a, b) => (a.lastDay < b.lastDay ? -1 : 1));
    expect(split.map((r) => [r.day, r.uses, r.activeDays, r.lastDay])).toEqual([
      ['2026-03-02', 1, 1, '2026-03-02'],
      ['2026-03-02', 1, 1, '2026-03-05'],
    ]);

    const out = await new GetFeatureUsageSummaryUseCase(deps(new Date('2026-06-30T15:00:00Z'), marker('2025-10-01'))).execute(
      query('2026-03-04', '2026-06-30', { granularity: 'week', tenantId: C }),
    );
    expect(out.source).toBe('daily');
    expect(out.range).toMatchObject({ previousFrom: '2025-11-05', previousTo: '2026-03-03' });
    expect(out.features.find((f) => f.key === 'offer_generator')).toMatchObject({ uses: 1, usesPrevious: 1, activeTenantsPrevious: 1 });
    expect(out.series[0]).toEqual({ bucket: '2026-03-02', activeTenants: 1 });
  });

  it('pior caso semeado (274 mil linhas): 90 dias + anterior por dia e 400 dias + anterior por semana cabem na guarda e no orçamento', async () => {
    const pairs = FEATURE_USAGE_CATALOG.flatMap((f) => f.kinds.map((k) => `('${f.key}', '${k}')`));
    expect(pairs).toHaveLength(18);
    await run(`
      INSERT INTO feature_usage_daily ("day", "tenantId", "featureKey", "kind", "uses", "updatedAt")
      SELECT d::date, t.id, p.k, p.kind, 1, (now() AT TIME ZONE 'UTC')
      FROM generate_series('2023-01-01'::date, '2023-01-01'::date + 799, interval '1 day') AS d
      CROSS JOIN (SELECT id FROM tenants WHERE id LIKE '${s}-bulk%') AS t
      CROSS JOIN (VALUES ${pairs.join(', ')}) AS p(k, kind)`);
    const [{ c }] = await prisma.$queryRawUnsafe<{ c: number }[]>(`SELECT count(*)::int AS c FROM feature_usage_daily WHERE "tenantId" LIKE '${s}-bulk%'`);
    expect(c).toBe(19 * 18 * 800);

    const reader = new PrismaDailyFeatureUsageReader(prisma);
    const keys = FEATURE_USAGE_CATALOG.map((f) => f.key);
    const bulk = <T extends { tenantId: string }>(rows: T[]) => rows.filter((r) => r.tenantId.startsWith(`${s}-bulk`));

    // 90 dias (2024-12-11..2025-03-10) + anterior, por dia
    let started = Date.now();
    const byDay = await reader.read({
      from: startOfDayInstant('2024-09-12'), toExclusive: startOfDayInstant('2025-03-11'), currentFrom: startOfDayInstant('2024-12-11'),
      featureKeys: keys, granularity: 'week', budget: createReadBudget(),
    });
    const dayMs = Date.now() - started;
    expect(bulk(byDay.rows)).toHaveLength(19 * 18 * 180);

    // 400 dias (2024-02-05..2025-03-10) + anterior, por semana (cada lado partido no início do período)
    started = Date.now();
    const byWeek = await reader.read({
      from: startOfDayInstant('2023-01-02'), toExclusive: startOfDayInstant('2025-03-11'), currentFrom: startOfDayInstant('2024-02-05'),
      featureKeys: keys, granularity: 'week', budget: createReadBudget(),
    });
    const weekMs = Date.now() - started;
    const weekRows = bulk(byWeek.rows);
    expect(weekRows.length).toBeLessThanOrEqual(19 * 18 * 116);
    expect(weekRows.length).toBeGreaterThan(19 * 18 * 110);
    expect(weekRows.reduce((sum, r) => sum + r.uses, 0)).toBe(19 * 18 * 799); // a janela começa em 2023-01-02
    console.info(`[T22] 90d/dia: ${byDay.rows.length} linhas em ${dayMs} ms; 400d/semana: ${byWeek.rows.length} linhas em ${weekMs} ms`);

    // Pela rota inteira (marco, agregado, diretório): responde do agregado sem 503
    const now = new Date('2025-03-10T15:00:00Z');
    for (const [from, granularity] of [['2024-12-11', 'day'], ['2024-02-05', 'week']] as const) {
      const out = await new GetFeatureUsageSummaryUseCase(deps(now, marker('2023-01-01'))).execute(query(from, '2025-03-10', { granularity }));
      expect(out.source).toBe('daily');
    }
  }, 120_000);
});
