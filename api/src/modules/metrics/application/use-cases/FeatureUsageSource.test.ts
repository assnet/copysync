import { describe, expect, it, vi } from 'vitest';
import { UsageMetricsRangeInvalidError, UsageMetricsReadUnavailableError } from '../../../../shared/errors/internal/UsageMetricsErrors';
import type { FeatureUsageRollupState } from '../../domain/contracts/IFeatureUsageRollupStateRepository';
import type { FeatureUsageRow } from '../../domain/services/aggregateFeatureUsage';
import { FEATURE_USAGE_CATALOG } from '../../domain/services/featureUsageCatalog';
import { PrismaDailyFeatureUsageReader } from '../../infrastructure/repositories/PrismaDailyFeatureUsageReader';
import type { UsageReadPrisma } from '../../infrastructure/repositories/featureUsageReadTimeout';
import { GetFeatureUsageDetailUseCase } from './GetFeatureUsageDetailUseCase';
import { type FeatureUsageQueryInput, GetFeatureUsageSummaryUseCase } from './GetFeatureUsageSummaryUseCase';
import { ListFeatureUsageTenantsUseCase } from './ListFeatureUsageTenantsUseCase';
import { FakeClock, FakeFeatureUsageReader, FakeUsageReadGate, FakeUsageTenantDirectory, usageRow, usageTenant } from './featureUsageTestFakes';

const NOW = new Date('2026-12-20T15:00:00.000Z'); // 12:00 em Brasília
const FRESH = new Date('2026-12-20T14:45:00.000Z');
const MARKER: FeatureUsageRollupState = { backfillCompletedAt: new Date('2026-11-20T10:00:00Z'), backfilledFrom: '2025-10-26', backfillStopReason: 'RETENTION', backfillCursor: null, cutovers: {}, lastSuccessAt: FRESH, finalizedThrough: null, failureStreak: 0 };
const NO_MARKER: FeatureUsageRollupState = { backfillCompletedAt: null, backfilledFrom: null, backfillStopReason: null, backfillCursor: null, cutovers: {}, lastSuccessAt: null, finalizedThrough: null, failureStreak: 0 };
const INPUT: FeatureUsageQueryInput = {
  from: '2026-11-21',
  to: '2026-12-20',
  granularity: 'day',
  kinds: [],
  tenantStatus: 'ACTIVE',
  includeInternal: false,
};

function setup(state: FeatureUsageRollupState, dailyRows: FeatureUsageRow[] = [], liveRows: FeatureUsageRow[] = []) {
  const clock = new FakeClock();
  const live = new FakeFeatureUsageReader(liveRows, { offer_generator: '2026-01-01', link_rotation_click: '2026-09-25' }, clock);
  const daily = new FakeFeatureUsageReader(dailyRows, { offer_generator: '2025-10-26', link_rotation_click: '2026-09-01', chat_send: '2026-11-19' }, clock);
  const rollupState = { get: vi.fn(async () => state) };
  const directory = new FakeUsageTenantDirectory([usageTenant('t1', 'COPYSYNC_MAX'), usageTenant('t2', 'COPYSYNC_LITE')], new Map([['t1', 'Um']]));
  const gate = new FakeUsageReadGate(clock);
  const log = { warn: vi.fn() };
  const deps = { reader: live, dailyReader: daily, rollupState, directory, gate, now: () => NOW, log };
  return {
    log,
    live,
    daily,
    rollupState,
    gate,
    summary: new GetFeatureUsageSummaryUseCase(deps),
    detail: new GetFeatureUsageDetailUseCase(deps),
    tenants: new ListFeatureUsageTenantsUseCase({ ...deps, audit: { create: vi.fn(async () => undefined) } }),
  };
}

describe('escolha da fonte', () => {
  const g = (lastSuccessAt: Date | null) => ({ failureStreak: 0, lastSuccessAt, backfillCursor: null, backfillDone: null, backfillFailures: 0 });

  it('recurso de grupo com backfill pendente não é coberto: até 90 dias live com warn, acima 503; os outros seguem no agregado', async () => {
    const state = { ...MARKER, backfillPendingKeys: ['link_rotation_click'] };
    const s = setup(state, [usageRow('2026-12-01', 't1', 'offer_generator', 'ACTION', 9)]);
    // Detalhe de recurso não pendente: agregado
    expect((await s.detail.execute({ ...INPUT, featureKey: 'offer_generator' }))).toMatchObject({ source: 'daily', liveReason: null });
    // Resumo inclui o pendente: fonte viva
    const out = await s.summary.execute(INPUT);
    expect(out).toMatchObject({ source: 'live', liveReason: 'PENDING', range: { maxDays: 90 } });
    expect(s.log.warn).toHaveBeenCalledWith(
      expect.objectContaining({ pending: ['link_rotation_click'] }),
      'feature usage daily aggregate pending backfill, reading live sources',
    );
    await expect(s.summary.execute({ ...INPUT, from: '2026-06-04', granularity: 'week' })).rejects.toBeInstanceOf(UsageMetricsReadUnavailableError);
  });

  it('frescor por grupo: grupo velho só envelhece os recursos dele; freshAt = menor frescor dos grupos pedidos', async () => {
    const OLD = new Date(NOW.getTime() - 3 * 3_600_000);
    const groups = { offer_generator: g(FRESH), 'link_rotation+link_rotation_click': g(OLD) };
    const s = setup({ ...MARKER, lastSuccessAt: OLD, groups });
    const detail = await s.detail.execute({ ...INPUT, featureKey: 'offer_generator' });
    expect(detail).toMatchObject({ source: 'daily', freshAt: FRESH });
    const click = await s.detail.execute({ ...INPUT, featureKey: 'link_rotation_click' });
    expect(click).toMatchObject({ source: 'live', liveReason: 'STALE' });
    // Só recurso do contador: vale o tick mais recente que deu certo
    expect((await s.detail.execute({ ...INPUT, featureKey: 'chat_send' })).source).toBe('daily');
  });

  it('sem marco cai em live mesmo com linhas no agregado; o agregado só responde pelos recursos do contador', async () => {
    const s = setup(NO_MARKER, [usageRow('2026-12-01', 't1', 'offer_generator', 'ACTION', 9), usageRow('2026-12-01', 't1', 'chat_send', 'ACTION', 2)]);
    const out = await s.summary.execute(INPUT);
    expect(out).toMatchObject({ source: 'live', liveReason: 'NO_AGGREGATE', freshAt: NOW, range: { maxDays: 90 } });
    expect(s.rollupState.get).toHaveBeenCalledWith(s.gate.budgets[0]);
    expect(s.live.calls[0]!.featureKeys).not.toContain('chat_send');
    // Story sem corte gravado é inteiro da fonte viva: o agregado só lê o chat
    expect([...s.daily.calls[0]!.featureKeys].sort()).toEqual(['chat_send']);
    expect(out.features.find((f) => f.key === 'offer_generator')!.uses).toBe(0); // a linha do agregado não entrou
    expect(out.features.find((f) => f.key === 'chat_send')).toMatchObject({ uses: 2, dataFrom: '2026-11-19', firstDataDay: '2026-11-19' });
  });

  it('agregado velho (último tick ≥ 45 min ou nunca): até 90 dias cai para live com warn; acima, 503', async () => {
    for (const lastSuccessAt of [new Date(NOW.getTime() - 45 * 60_000), null]) {
      const s = setup({ ...MARKER, lastSuccessAt }, [usageRow('2026-12-01', 't1', 'offer_generator', 'ACTION', 9)]);
      const out = await s.summary.execute(INPUT);
      expect(out).toMatchObject({ source: 'live', liveReason: 'STALE', freshAt: NOW, range: { maxDays: 90 } });
      expect(out.features.find((f) => f.key === 'offer_generator')!.uses).toBe(0);
      expect(s.log.warn).toHaveBeenCalledWith(expect.objectContaining({ days: 30 }), 'feature usage daily aggregate stale, reading live sources');
      const long = s.summary.execute({ ...INPUT, from: '2026-06-04', granularity: 'week' });
      await expect(long).rejects.toBeInstanceOf(UsageMetricsReadUnavailableError);
    }
    // 44 min: ainda fresco
    const fresh = setup({ ...MARKER, lastSuccessAt: new Date(NOW.getTime() - 44 * 60_000) });
    expect((await fresh.summary.execute(INPUT)).source).toBe('daily');
    expect(fresh.log.warn).not.toHaveBeenCalled();
  });

  it('com marco cobrindo o período: uma leitura do agregado, freshAt = último tick bem-sucedido e teto 400', async () => {
    const s = setup(MARKER, [usageRow('2026-12-01', 't1', 'offer_generator', 'ACTION', 9)]);
    const out = await s.summary.execute(INPUT);
    expect(out).toMatchObject({ source: 'daily', liveReason: null, freshAt: FRESH, range: { maxDays: 400 } });
    expect(s.live.calls).toHaveLength(0);
    expect(s.daily.calls).toHaveLength(1);
    expect(s.daily.calls[0]!.currentFrom!.toISOString()).toBe('2026-11-21T03:00:00.000Z');
    expect(out.features.find((f) => f.key === 'offer_generator')!.uses).toBe(9);
  });

  it('período que começa antes de backfilledFrom: fonte viva', async () => {
    const s = setup({ ...MARKER, backfilledFrom: '2026-11-22' });
    expect(await s.summary.execute(INPUT)).toMatchObject({ source: 'live', liveReason: 'NOT_COVERED' });
    expect(await s.detail.execute({ ...INPUT, featureKey: 'offer_generator' })).toMatchObject({ source: 'live', liveReason: 'NOT_COVERED' });
  });

  it('marco pela metade (backfill sem conclusão) também é NO_AGGREGATE', async () => {
    const s = setup({ ...MARKER, backfillCompletedAt: null });
    expect(await s.summary.execute(INPUT)).toMatchObject({ source: 'live', liveReason: 'NO_AGGREGATE' });
  });

  it('200 dias: sem agregado = 400 (teto 90), com agregado = 200; 401 dias com agregado = 400', async () => {
    const long = { ...INPUT, from: '2026-06-04', granularity: 'week' as const };
    const err = await setup(NO_MARKER).summary.execute(long).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UsageMetricsRangeInvalidError);
    expect((err as UsageMetricsRangeInvalidError).meta).toMatchObject({ maxDays: 90 });

    const s = setup(MARKER);
    const out = await s.summary.execute(long);
    expect(out).toMatchObject({ source: 'daily', range: { from: '2026-06-04', maxDays: 400 } });
    expect(s.daily.calls[0]!.granularity).toBe('week');

    const s401 = setup(MARKER);
    await expect(s401.summary.execute({ ...INPUT, from: '2025-11-15', granularity: 'week' })).rejects.toBeInstanceOf(UsageMetricsRangeInvalidError);
    expect(s401.gate.opened).toBe(0);
  });

  it('acima de 90 dias o leitor nunca recebe dia (segunda trava além do schema)', async () => {
    const s = setup(MARKER);
    await expect(s.summary.execute({ ...INPUT, from: '2026-08-22', granularity: 'day' })).rejects.toBeInstanceOf(UsageMetricsRangeInvalidError);
    expect(s.daily.calls).toHaveLength(0);
    expect(s.live.calls).toHaveLength(0);
  });

  it('lista de contas lê do agregado só o período atual quando o marco cobre', async () => {
    const s = setup(MARKER, [usageRow('2026-12-01', 't1', 'offer_generator', 'ACTION', 5)]);
    const out = await s.tenants.execute({ ...INPUT, featureKey: 'offer_generator', actorUserId: 'admin' });
    expect(out.items).toEqual([expect.objectContaining({ tenantId: 't1', tenantName: 'Um', uses: 5 })]);
    expect(s.live.calls).toHaveLength(0);
    expect(s.daily.calls[0]!.from.toISOString()).toBe('2026-11-21T03:00:00.000Z');
  });
});

describe('cobertura com agregado', () => {
  it('link_rotation_click agregado desde D: sem RETENTION nem EXISTING_ONLY a partir de D, dataFrom = D', async () => {
    const out = await setup(MARKER).summary.execute({ ...INPUT, kinds: ['AUDIENCE'] });
    expect(out.features[0]).toMatchObject({ key: 'link_rotation_click', coverageReasons: [], coverage: 'FULL', dataFrom: '2026-09-01' });
  });

  it('RETENTION/EXISTING_ONLY comparam com a cobertura do marco, não com o primeiro dia com uso', async () => {
    // Marco: backfilledFrom 2025-10-26, fim 2026-11-20; clique (retenção 90) coberto desde 2026-08-22
    const out = await setup(MARKER).summary.execute({ ...INPUT, from: '2026-08-01', granularity: 'week', kinds: ['AUDIENCE'] });
    expect(out.features[0]).toMatchObject({ coverageReasons: ['RETENTION'], dataFrom: '2026-09-01' });
    // Começa depois da poda (08-22) e antes do primeiro clique agregado (09-01): nada a apontar
    const mid = await setup(MARKER).summary.execute({ ...INPUT, from: '2026-08-25', granularity: 'week', kinds: ['AUDIENCE'] });
    expect(mid.features[0]!.coverageReasons).toEqual([]);
    // Antes de backfilledFrom (RETENTION no marco cobre só a partir dele): EXISTING_ONLY e RETENTION
    const old = setup({ ...MARKER, backfilledFrom: '2026-08-10' });
    const before = await old.summary.execute({ ...INPUT, from: '2026-08-10', to: '2026-11-07', granularity: 'week', kinds: ['AUDIENCE'] });
    expect(before.features[0]!.coverageReasons).toEqual(['RETENTION']);
    expect(
      (await setup({ ...MARKER, backfilledFrom: '2026-08-10', backfillStopReason: 'FIRST_DATA' }).summary.execute({
        ...INPUT, from: '2026-08-01', to: '2026-10-29', granularity: 'week', kinds: ['AUDIENCE'],
      })).features[0]!.coverageReasons,
    ).toEqual(['EXISTING_ONLY', 'RETENTION']);
  });

  it('backfill parado no primeiro dado (FIRST_DATA): 365 dias começando antes de backfilledFrom usam o agregado', async () => {
    const first = { ...MARKER, backfilledFrom: '2026-10-26', backfillStopReason: 'FIRST_DATA' as const };
    const s = setup(first, [usageRow('2026-11-02', 't1', 'offer_generator', 'ACTION', 3)]);
    const out = await s.summary.execute({ ...INPUT, from: '2025-12-21', granularity: 'month' });
    expect(out).toMatchObject({ source: 'daily', range: { from: '2025-12-21', maxDays: 400 } });
    expect(out.features.find((f) => f.key === 'offer_generator')!.uses).toBe(3);
    expect(s.live.calls).toHaveLength(0);
    // Mesmo marco com RETENTION: o período começa antes da cobertura → fonte viva, que não passa de 90 dias
    const r = setup({ ...first, backfillStopReason: 'RETENTION' });
    await expect(r.summary.execute({ ...INPUT, from: '2025-12-21', granularity: 'month' })).rejects.toBeInstanceOf(UsageMetricsRangeInvalidError);
  });

  it('fonte viva mantém o comportamento da P1 (retenção pelo relógio, EXISTING_ONLY sempre)', async () => {
    const out = await setup(NO_MARKER).summary.execute({ ...INPUT, kinds: ['AUDIENCE'] });
    expect(out.features[0]).toMatchObject({ coverageReasons: ['EXISTING_ONLY'], dataFrom: '2026-09-25' });
  });

  it('Story em fonte viva soma a fonte viva antes do corte gravado e o contador a partir dele', async () => {
    const s = setup(
      { ...NO_MARKER, cutovers: { offer_story: '2026-11-19' } },
      [usageRow('2026-11-18', 't1', 'offer_story', 'ACTION', 7), usageRow('2026-11-20', 't1', 'offer_story', 'ACTION', 2)],
      [usageRow('2026-11-18', 't2', 'offer_story', 'ACTION', 1)],
    );
    const out = await s.summary.execute({ ...INPUT, from: '2026-11-18', granularity: 'week' });
    const story = out.features.find((f) => f.key === 'offer_story')!;
    expect(story).toMatchObject({ uses: 3, activeTenants: 2, coverageReasons: ['AI_HEADLINE_ONLY'] });
    // Linha por dia no agregado mesmo com série semanal: o recorte pelo corte é exato
    expect(s.daily.calls[0]!.granularity).toBe('day');
  });

  it('Story sem corte gravado: inteiro da fonte viva, linha do agregado ignorada', async () => {
    const s = setup(
      NO_MARKER,
      [usageRow('2026-11-20', 't1', 'offer_story', 'ACTION', 2)],
      [usageRow('2026-11-18', 't2', 'offer_story', 'ACTION', 1), usageRow('2026-11-20', 't2', 'offer_story', 'ACTION', 4)],
    );
    const out = await s.summary.execute({ ...INPUT, from: '2026-11-18', granularity: 'week' });
    expect(out.features.find((f) => f.key === 'offer_story')).toMatchObject({ uses: 5, activeTenants: 1, coverageReasons: ['AI_HEADLINE_ONLY'] });
    expect(s.daily.calls.every((c) => !c.featureKeys.includes('offer_story'))).toBe(true);
  });

  it('com corte gravado a linha viva do dia do corte em diante não conta', async () => {
    const s = setup(
      { ...NO_MARKER, cutovers: { offer_story: '2026-11-19' } },
      [],
      [usageRow('2026-11-18', 't2', 'offer_story', 'ACTION', 1), usageRow('2026-11-20', 't2', 'offer_story', 'ACTION', 4)],
    );
    const out = await s.summary.execute({ ...INPUT, from: '2026-11-18', granularity: 'week' });
    expect(out.features.find((f) => f.key === 'offer_story')).toMatchObject({ uses: 1 });
  });
});

describe('guarda de linhas do agregado', () => {
  it('93 contas densas em 90 dias (+ anterior) estouram 300 mil linhas: 503', async () => {
    const pairs = FEATURE_USAGE_CATALOG.flatMap((f) => f.kinds.map((k) => [f.key, k] as const));
    expect(pairs).toHaveLength(18);
    const total = 93 * pairs.length * 180;
    expect(total).toBeGreaterThan(300_000);
    const prisma = {
      $executeRawUnsafe: vi.fn(() => Promise.resolve(0)),
      $queryRaw: vi.fn(() => Promise.resolve([])),
      $transaction: vi.fn(async () => [
        0,
        Array.from({ length: Math.min(total, 300_001) }, (_, i) => ({
          day: '2026-10-01', tenantId: `t${i % 93}`, featureKey: 'offer_generator', kind: 'ACTION', uses: 1, activeDays: 1, lastDay: '2026-10-01',
        })),
      ]),
    } as unknown as UsageReadPrisma;
    const s = setup(MARKER);
    const deps = {
      reader: s.live,
      dailyReader: new PrismaDailyFeatureUsageReader(prisma),
      rollupState: s.rollupState,
      directory: new FakeUsageTenantDirectory([]),
      gate: new FakeUsageReadGate(),
      now: () => NOW,
    };
    await expect(new GetFeatureUsageSummaryUseCase(deps).execute({ ...INPUT, from: '2026-09-22' })).rejects.toBeInstanceOf(
      UsageMetricsReadUnavailableError,
    );
  });
});
