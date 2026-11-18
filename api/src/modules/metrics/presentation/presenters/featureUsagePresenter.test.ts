import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GetFeatureUsageSummaryUseCase, type FeatureUsageQueryInput } from '../../application/use-cases/GetFeatureUsageSummaryUseCase';
import { GetFeatureUsageDetailUseCase } from '../../application/use-cases/GetFeatureUsageDetailUseCase';
import { ListFeatureUsageTenantsUseCase } from '../../application/use-cases/ListFeatureUsageTenantsUseCase';
import {
  FakeFeatureUsageReader,
  FakeUsageReadGate,
  FakeUsageTenantDirectory,
  usageRow,
  usageTenant,
} from '../../application/use-cases/featureUsageTestFakes';
import { GetFeatureUsageScreensUseCase } from '../../application/use-cases/GetFeatureUsageScreensUseCase';
import {
  presentFeatureUsageDetail,
  presentFeatureUsageScreens,
  presentFeatureUsageSummary,
  presentFeatureUsageTenants,
} from './featureUsagePresenter';

const CONTRACTS = join(__dirname, '../../../../../../contracts/feature-usage');
const fixture = (name: string) => JSON.parse(readFileSync(join(CONTRACTS, name), 'utf8')) as unknown;

/**
 * Mesmas chaves e mesmos tipos em todos os níveis. `null` de um lado aceita qualquer tipo do outro (campo
 * anulável); array compara cada item com cada item do exemplo.
 */
function sameShape(actual: unknown, expected: unknown, path = '$'): string[] {
  if (actual === null || expected === null) return [];
  if (Array.isArray(expected) || Array.isArray(actual)) {
    if (!Array.isArray(expected) || !Array.isArray(actual)) return [`${path}: array × não array`];
    return actual.flatMap((a, i) => expected.flatMap((e) => sameShape(a, e, `${path}[${i}]`)));
  }
  if (typeof expected === 'object' || typeof actual === 'object') {
    if (typeof expected !== 'object' || typeof actual !== 'object') return [`${path}: objeto × ${typeof actual}`];
    const a = Object.keys(actual as object).sort();
    const e = Object.keys(expected as object).sort();
    const extra = a.filter((k) => !e.includes(k)).map((k) => `${path}.${k}: campo a mais`);
    const missing = e.filter((k) => !a.includes(k)).map((k) => `${path}.${k}: campo a menos`);
    const nested = a
      .filter((k) => e.includes(k))
      .flatMap((k) => sameShape((actual as Record<string, unknown>)[k], (expected as Record<string, unknown>)[k], `${path}.${k}`));
    return [...extra, ...missing, ...nested];
  }
  return typeof actual === typeof expected ? [] : [`${path}: ${typeof actual} × ${typeof expected}`];
}

const NOW = new Date('2026-11-17T15:00:00.000Z');
const INPUT: FeatureUsageQueryInput = {
  from: '2026-08-18',
  to: '2026-11-15',
  granularity: 'week',
  kinds: ['ACTION', 'AUTOMATIC'],
  tenantStatus: 'ACTIVE',
  includeInternal: false,
};

/** Agregado com marco e último tick há 15 min: as mesmas linhas vêm do `dailyReader`. */
const LAST_TICK = new Date('2026-11-17T14:45:00.000Z');
function dailyUseCases() {
  const base = useCasesDeps();
  const dailyReader = base.reader;
  const live = new FakeFeatureUsageReader();
  const rollupState = {
    get: async () => ({
      backfillCompletedAt: new Date('2026-11-10T00:00:00.000Z'),
      backfilledFrom: '2026-01-01',
      backfillStopReason: 'FIRST_DATA' as const,
      backfillCursor: null,
      lastSuccessAt: LAST_TICK,
      finalizedThrough: '2026-11-15',
      failureStreak: 0,
      cutovers: {},
    }),
  };
  const deps = { ...base, reader: live, dailyReader, rollupState };
  return { summary: new GetFeatureUsageSummaryUseCase(deps), detail: new GetFeatureUsageDetailUseCase(deps), live };
}

function useCases() {
  const deps = useCasesDeps();
  const audit = { create: async () => undefined };
  return {
    summary: new GetFeatureUsageSummaryUseCase(deps),
    detail: new GetFeatureUsageDetailUseCase(deps),
    tenants: new ListFeatureUsageTenantsUseCase({ ...deps, audit }),
  };
}

function useCasesDeps() {
  const reader = new FakeFeatureUsageReader(
    [
      usageRow('2026-11-10', 't1', 'offer_generator', 'ACTION', 3),
      usageRow('2026-05-25', 't1', 'offer_generator', 'ACTION', 2),
      usageRow('2026-11-12', 't2', 'offer_hunter', 'ACTION', 2),
      usageRow('2026-11-13', 't2', 'offer_hunter', 'AUTOMATIC', 5),
      usageRow('2026-11-14', 't2', 'link_rotation', 'ACTION', 1),
    ],
    { offer_generator: '2026-03-02', offer_hunter: '2026-11-03', link_rotation: '2026-01-10' },
  );
  const directory = new FakeUsageTenantDirectory([
    usageTenant('t1', 'COPYSYNC_MAX'),
    usageTenant('t2', 'COPYSYNC_LITE', 'SAVER_PRO'),
    usageTenant('t3', 'NONE', 'SAVER_LITE', { internal: true }),
  ]);
  return { reader, directory, gate: new FakeUsageReadGate(), now: () => NOW };
}

describe('featureUsagePresenter × contrato', () => {
  it('resumo bate com contracts/feature-usage/summary.response.json', async () => {
    const body = presentFeatureUsageSummary(await useCases().summary.execute(INPUT));
    expect(sameShape(body, fixture('summary.response.json'))).toEqual([]);
    expect(body.features.find((f) => f.key === 'link_rotation')!.coverageReasons).toEqual(['EXISTING_ONLY']);
    // P3: recorrência e retenção preenchidas no resumo (sem leitor de direito, adoção `null`)
    const generator = body.features.find((f) => f.key === 'offer_generator')!;
    expect(generator).toMatchObject({ eligibleTenants: null, adoption: null, recurringTenants: 0 });
    expect(typeof generator.retainedTenants).toBe('number');
  });

  it('detalhe bate com contracts/feature-usage/feature-detail.response.json', async () => {
    const body = presentFeatureUsageDetail(await useCases().detail.execute({ ...INPUT, featureKey: 'offer_hunter' }));
    expect(sameShape(body, fixture('feature-detail.response.json'))).toEqual([]);
    expect(body.feature.byKind).toEqual([
      { kind: 'ACTION', uses: 2, activeTenants: 1 },
      { kind: 'AUTOMATIC', uses: 5, activeTenants: 1 },
    ]);
  });

  it('detalhe fora do recorte também bate com o exemplo', async () => {
    const body = presentFeatureUsageDetail(await useCases().detail.execute({ ...INPUT, featureKey: 'panel_login' }));
    expect(body.inScope).toBe(false);
    expect(sameShape(body, fixture('feature-detail.response.json'))).toEqual([]);
  });

  it('lista de contas bate com contracts/feature-usage/feature-tenants.response.json', async () => {
    const body = presentFeatureUsageTenants(await useCases().tenants.execute({ ...INPUT, featureKey: 'offer_hunter', actorUserId: 'admin-1' }));
    expect(body.items.length).toBeGreaterThan(0);
    expect(sameShape(body, fixture('feature-tenants.response.json'))).toEqual([]);
    const sample = fixture('feature-tenants.response.json') as { nextCursor: string | null };
    expect(sameShape({ ...body, nextCursor: 'x' }, sample)).toEqual([]);
  });

  it('resumo e detalhe pelo agregado batem com os exemplos daily (source, teto 400, freshAt = último tick)', async () => {
    const d = dailyUseCases();
    const summary = presentFeatureUsageSummary(await d.summary.execute(INPUT));
    const sample = fixture('summary.daily.response.json') as { source: string; range: { maxDays: number }; freshAt: string };
    expect(sameShape(summary, sample)).toEqual([]);
    expect({ source: summary.source, maxDays: summary.range.maxDays }).toEqual({ source: sample.source, maxDays: sample.range.maxDays });
    expect(summary.freshAt).toBe(LAST_TICK.toISOString());
    expect(Number.isNaN(Date.parse(sample.freshAt))).toBe(false);
    expect(d.live.calls).toHaveLength(0);

    const detail = presentFeatureUsageDetail(await d.detail.execute({ ...INPUT, featureKey: 'offer_hunter' }));
    const detailSample = fixture('feature-detail.daily.response.json') as { source: string };
    expect(sameShape(detail, detailSample)).toEqual([]);
    expect(detail.source).toBe(detailSample.source);
    expect(detail.freshAt).toBe(LAST_TICK.toISOString());
  });

  it('telas batem com contracts/feature-usage/screens.response.json', async () => {
    const pageViews = { read: async () => ({ rows: [{ key: 'view:offers', tenants: 1, tenantDays: 2 }], firstDataDay: '2026-11-19' }) };
    const directory = new FakeUsageTenantDirectory([usageTenant('t1', 'COPYSYNC_MAX')]);
    const out = await new GetFeatureUsageScreensUseCase({ pageViews, directory, gate: new FakeUsageReadGate(), now: () => NOW }).execute(INPUT);
    const body = presentFeatureUsageScreens(out);
    expect(sameShape(body, fixture('screens.response.json'))).toEqual([]);
    expect(JSON.stringify(body)).not.toMatch(/tenantId|"t1"/);
  });

  it('a comparação falha com campo a mais ou a menos', () => {
    const base = fixture('summary.response.json') as Record<string, unknown>;
    expect(sameShape({ ...base, extra: 1 }, base)).toEqual(['$.extra: campo a mais']);
    const { freshAt: _drop, ...without } = base;
    expect(sameShape(without, base)).toEqual(['$.freshAt: campo a menos']);
  });

  it('resumo sem nome de conta, sem total de usos e sem contagem de usuários', async () => {
    const text = JSON.stringify(presentFeatureUsageSummary(await useCases().summary.execute(INPUT)));
    expect(text).not.toMatch(/tenantName|activeUsers|"name"/);
    const body = presentFeatureUsageSummary(await useCases().summary.execute(INPUT));
    expect(body.totals).not.toHaveProperty('uses');
    expect(body.freshAt).toBe(NOW.toISOString());
  });

  it('lista de contas: só os campos do contrato', () => {
    const extra = { secret: 'x' };
    const body = presentFeatureUsageTenants({
      items: [
        {
          tenantId: 't1',
          tenantName: 'Conta Um',
          plan: 'COPYSYNC_PRO',
          status: 'ACTIVE',
          internal: false,
          uses: 3,
          activeDays: 2,
          lastUsedDay: '2026-11-12',
          ...extra,
        },
      ],
      nextCursor: null,
    });
    expect(Object.keys(body.items[0]!).sort()).toEqual(
      ['activeDays', 'internal', 'lastUsedDay', 'plan', 'status', 'tenantId', 'tenantName', 'uses'].sort(),
    );
  });
});
