import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  UsageMetricsFeatureNotFoundError,
  UsageMetricsRangeInvalidError,
  UsageMetricsReadUnavailableError,
} from '../../../../shared/errors/internal/UsageMetricsErrors';
import { type FeatureUsageQueryInput, GetFeatureUsageSummaryUseCase } from './GetFeatureUsageSummaryUseCase';
import { GetFeatureUsageDetailUseCase } from './GetFeatureUsageDetailUseCase';
import { FakeClock, FakeFeatureUsageReader, FakeUsageReadGate, FakeUsageTenantDirectory, usageRow, usageTenant } from './featureUsageTestFakes';

const NOW = new Date('2026-11-17T15:00:00.000Z'); // 12:00 em Brasília
const INPUT: FeatureUsageQueryInput = {
  from: '2026-10-19',
  to: '2026-11-17',
  granularity: 'day',
  kinds: ['ACTION', 'AUTOMATIC'],
  tenantStatus: 'ACTIVE',
  includeInternal: false,
};

function setup() {
  const clock = new FakeClock();
  const reader = new FakeFeatureUsageReader(
    [usageRow('2026-11-10', 't1', 'offer_generator', 'ACTION', 3), usageRow('2026-11-11', 't2', 'offer_generator', 'ACTION', 2)],
    { offer_generator: '2026-01-01' },
    clock,
  );
  const directory = new FakeUsageTenantDirectory([usageTenant('t1', 'COPYSYNC_MAX'), usageTenant('t2', 'COPYSYNC_LITE')]);
  const gate = new FakeUsageReadGate(clock);
  const deps = { reader, directory, gate, now: () => NOW };
  return { clock, reader, directory, gate, summary: new GetFeatureUsageSummaryUseCase(deps), detail: new GetFeatureUsageDetailUseCase(deps) };
}

describe('GetFeatureUsageSummaryUseCase', () => {
  it('uma leitura por pedido, com a janela alargada até o início do período anterior', async () => {
    const { reader, summary } = setup();
    const out = await summary.execute(INPUT);
    expect(reader.calls).toHaveLength(1);
    // período anterior 2026-09-19 → meia-noite de Brasília = 03:00 UTC
    expect(reader.calls[0]!.from.toISOString()).toBe('2026-09-19T03:00:00.000Z');
    expect(reader.calls[0]!.toExclusive.toISOString()).toBe('2026-11-18T03:00:00.000Z');
    expect(reader.calls[0]!.featureKeys).not.toContain('panel_login');
    expect(out.features.find((f) => f.key === 'offer_generator')).toMatchObject({ uses: 5, activeTenants: 2 });
    expect(out.totals.activeTenants).toBe(2);
  });

  it('um orçamento por pedido: tempo gasto no leitor reduz o que o diretório recebe', async () => {
    const { reader, directory, gate, summary } = setup();
    reader.spendMs = 500;
    await summary.execute(INPUT);
    expect(gate.opened).toBe(1);
    expect(reader.calls[0]!.budget).toBe(gate.budgets[0]);
    expect(directory.listBudgets).toEqual([1500]);
  });

  it('dois pedidos simultâneos: o segundo espera a vaga e conclui', async () => {
    const { reader, gate, summary } = setup();
    let release!: () => void;
    reader.hold = new Promise((r) => (release = r));
    const first = summary.execute(INPUT);
    const second = summary.execute(INPUT);
    await new Promise((r) => setTimeout(r, 0));
    expect(gate.opened).toBe(1);
    release();
    await expect(Promise.all([first, second])).resolves.toHaveLength(2);
    expect(gate.opened).toBe(2);
    expect(gate.busy).toBe(false);
  });

  it('erro na leitura devolve a vaga', async () => {
    const { reader, gate, summary } = setup();
    reader.fail = new UsageMetricsReadUnavailableError();
    await expect(summary.execute(INPUT)).rejects.toBeInstanceOf(UsageMetricsReadUnavailableError);
    expect(gate.busy).toBe(false);
  });

  it('fonte viva, freshAt = agora e teto de 90 dias em range.maxDays', async () => {
    const out = await setup().summary.execute(INPUT);
    expect(out.source).toBe('live');
    expect(out.freshAt).toEqual(NOW);
    expect(out.range).toEqual({
      from: '2026-10-19',
      to: '2026-11-17',
      timeZone: 'America/Sao_Paulo',
      previousFrom: '2026-09-19',
      previousTo: '2026-10-18',
      granularity: 'day',
      maxDays: 90,
    });
  });

  it('91 dias: USAGE_METRICS_RANGE_INVALID sem abrir o gate', async () => {
    const { gate, summary } = setup();
    await expect(summary.execute({ ...INPUT, from: '2026-08-19', granularity: 'week' })).rejects.toBeInstanceOf(UsageMetricsRangeInvalidError);
    expect(gate.opened).toBe(0);
  });

  it('conta inexistente no filtro: zeros, não erro', async () => {
    const out = await setup().summary.execute({ ...INPUT, tenantId: 'nao-existe' });
    expect(out.totals.activeTenants).toBe(0);
    expect(out.population.tenants).toBe(0);
    expect(out.features.every((f) => f.uses === 0)).toBe(true);
  });

  it('plano do Saver lê só recursos do Saver', async () => {
    const { reader, summary } = setup();
    await summary.execute({ ...INPUT, plan: 'SAVER_PRO' });
    expect(reader.calls[0]!.featureKeys).toEqual(['saver_extraction', 'saver_export']);
  });
});

describe('GetFeatureUsageDetailUseCase', () => {
  it('um recurso: item, série do recurso e uma leitura só dele', async () => {
    const { reader, detail } = setup();
    const out = await detail.execute({ ...INPUT, featureKey: 'offer_generator' });
    expect(reader.calls).toHaveLength(1);
    expect(reader.calls[0]!.featureKeys).toEqual(['offer_generator']);
    expect(out.feature).toMatchObject({ key: 'offer_generator', uses: 5, activeTenants: 2 });
    expect(out.series).toHaveLength(30);
    expect(out.series.find((s) => s.bucket === '2026-11-10')).toEqual({ bucket: '2026-11-10', uses: 3, activeTenants: 1 });
    expect(out.range.maxDays).toBe(90);
  });

  it('o filtro de produto não esconde o recurso do detalhe', async () => {
    const out = await setup().detail.execute({ ...INPUT, product: 'SAVER', featureKey: 'offer_generator' });
    expect(out.feature.key).toBe('offer_generator');
  });

  it.each([
    ['chave fora do catálogo', { featureKey: 'nao_existe' }],
    ['tipo que não cruza', { featureKey: 'panel_login' }],
    ['plano de outra família', { featureKey: 'offer_generator', plan: 'SAVER_MAX' }],
  ])('%s: USAGE_METRICS_FEATURE_NOT_FOUND sem abrir o gate', async (_label, over) => {
    const { gate, detail } = setup();
    await expect(detail.execute({ ...INPUT, ...over })).rejects.toBeInstanceOf(UsageMetricsFeatureNotFoundError);
    expect(gate.opened).toBe(0);
  });
});

describe('camadas', () => {
  it.each(['GetFeatureUsageSummaryUseCase.ts', 'GetFeatureUsageDetailUseCase.ts', 'featureUsageTestFakes.ts'])(
    '%s sem Prisma nem Fastify',
    (file) => {
      const src = readFileSync(join(__dirname, file), 'utf8');
      expect(src).not.toMatch(/@prisma\/client|from 'fastify'|\/infrastructure\//);
    },
  );
});
