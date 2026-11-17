import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GetFeatureUsageSummaryUseCase, type FeatureUsageQueryInput } from '../../application/use-cases/GetFeatureUsageSummaryUseCase';
import { GetFeatureUsageDetailUseCase } from '../../application/use-cases/GetFeatureUsageDetailUseCase';
import {
  FakeFeatureUsageReader,
  FakeUsageReadGate,
  FakeUsageTenantDirectory,
  usageRow,
  usageTenant,
} from '../../application/use-cases/featureUsageTestFakes';
import { presentFeatureUsageDetail, presentFeatureUsageSummary, presentFeatureUsageTenants } from './featureUsagePresenter';

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

function useCases() {
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
  const deps = { reader, directory, gate: new FakeUsageReadGate(), now: () => NOW };
  return { summary: new GetFeatureUsageSummaryUseCase(deps), detail: new GetFeatureUsageDetailUseCase(deps) };
}

describe('featureUsagePresenter × contrato', () => {
  it('resumo bate com contracts/feature-usage/summary.response.json', async () => {
    const body = presentFeatureUsageSummary(await useCases().summary.execute(INPUT));
    expect(sameShape(body, fixture('summary.response.json'))).toEqual([]);
    expect(body.features.find((f) => f.key === 'link_rotation')!.coverageReasons).toEqual(['EXISTING_ONLY']);
  });

  it('detalhe bate com contracts/feature-usage/feature-detail.response.json', async () => {
    const body = presentFeatureUsageDetail(await useCases().detail.execute({ ...INPUT, featureKey: 'offer_hunter' }));
    expect(sameShape(body, fixture('feature-detail.response.json'))).toEqual([]);
    expect(body.feature.byKind).toEqual([
      { kind: 'ACTION', uses: 2, activeTenants: 1 },
      { kind: 'AUTOMATIC', uses: 5, activeTenants: 1 },
    ]);
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
