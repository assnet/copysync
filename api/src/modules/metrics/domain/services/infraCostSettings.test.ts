import { describe, expect, it } from 'vitest';
import { InvalidInfraCostSettingsError } from '../../../../shared/errors/internal/InfraCostErrors';
import {
  DEFAULT_INFRA_COST_SETTINGS,
  INFRA_COST_LIMITS,
  defaultInfraCostSettings,
  parseInfraCostSettings,
  resolveInfraCostSettings,
  type InfraCostItem,
  type InfraCostSettings,
} from './infraCostSettings';

function valid(): InfraCostSettings {
  return defaultInfraCostSettings();
}

/** Documento válido com uma alteração aplicada por `mutate` (sobre JSON cru). */
function withChange(mutate: (doc: Record<string, any>) => void): Record<string, any> {
  const doc = JSON.parse(JSON.stringify(valid())) as Record<string, any>;
  mutate(doc);
  return doc;
}

function fieldOf(input: unknown): string {
  try {
    parseInfraCostSettings(input);
  } catch (err) {
    expect(err).toBeInstanceOf(InvalidInfraCostSettingsError);
    const error = err as InvalidInfraCostSettingsError;
    expect(error.statusCode).toBe(400);
    expect(error.code).toBe('INVALID_INFRA_COST_SETTINGS');
    expect(error.meta).toEqual({ field: error.field });
    return error.field;
  }
  throw new Error('esperava erro de validação');
}

function extraItem(index: number): InfraCostItem {
  return { ...valid().items[5]!, key: `extra-${index}`, renderKey: null };
}

describe('valores iniciais da configuração de custos', () => {
  it('passam na própria validação', () => {
    expect(parseInfraCostSettings(valid())).toEqual(DEFAULT_INFRA_COST_SETTINGS);
  });

  it('seguem as decisões do dono: disco 15 GB, e-mail 23, R2 0, workspace Hobby, cotação automática', () => {
    const d = DEFAULT_INFRA_COST_SETTINGS;
    const byKey = Object.fromEntries(d.items.map((i) => [i.key, i]));
    expect(byKey.api).toMatchObject({ monthlyUsd: 25, billing: 'per_instance', storage: { gb: 15, usdPerGb: 0.25 }, renderKey: 'api' });
    expect(byKey.worker).toMatchObject({ monthlyUsd: 25, billing: 'per_instance', quantity: 1, renderKey: 'worker' });
    expect(byKey.static).toMatchObject({ monthlyUsd: 0, renderKey: 'static' });
    expect(byKey.redis).toMatchObject({ monthlyUsd: 20, renderKey: 'redis' });
    expect(byKey.postgres).toMatchObject({ monthlyUsd: 19, storage: { gb: 15, usdPerGb: 0.3 }, renderKey: 'postgres' });
    expect(byKey.email).toMatchObject({ billing: 'fixed', monthlyUsd: 23 });
    expect(byKey.r2).toMatchObject({ billing: 'usage', monthlyUsd: 0 });
    expect(d.items.every((i) => i.allocation === 'shared')).toBe(true);
    expect(d.workspace).toMatchObject({
      planLabel: 'Hobby',
      cycleStartDay: 1,
      includedBandwidthGb: 5,
      includedBuildMinutes: 500,
      bandwidthUsdPerGb: 0.15,
      buildUsdPer1000Min: 5,
      manualBandwidthGb: null,
      manualBuildMinutes: null,
    });
    expect(d.fx).toEqual({ auto: true, override: null, closingMethod: 'last_business_day' });
    expect(d.renderPlanPrices).toContainEqual({ resourceType: 'service', plan: '1c-2g', monthlyUsd: 25 });
    expect(d.renderPlanPrices).toContainEqual({ resourceType: 'postgres', plan: '0.5c-1g', monthlyUsd: 19 });
    expect(d.renderPlanPrices.filter((p) => p.resourceType === 'key_value')).toHaveLength(1);
  });

  it('somam US$ 120,25 fixos com 1 worker (computação + disco a 15 GB)', () => {
    const total = DEFAULT_INFRA_COST_SETTINGS.items.reduce(
      (sum, i) => sum + i.monthlyUsd * (i.billing === 'usage' ? 1 : i.quantity) + (i.storage?.gb ?? 0) * (i.storage?.usdPerGb ?? 0),
      0,
    );
    expect(total).toBeCloseTo(120.25, 6);
  });

  it('cópia nova a cada chamada: alterar não muda o default', () => {
    const copy = defaultInfraCostSettings();
    copy.items[0]!.monthlyUsd = 999;
    expect(DEFAULT_INFRA_COST_SETTINGS.items[0]!.monthlyUsd).toBe(25);
  });
});

describe('parseInfraCostSettings', () => {
  it('rejeita não-objeto e campo de topo desconhecido ou faltando', () => {
    expect(fieldOf(null)).toBe('settings');
    expect(fieldOf([])).toBe('settings');
    expect(fieldOf(withChange((d) => (d.extra = 1)))).toBe('extra');
    expect(fieldOf(withChange((d) => delete d.workspace))).toBe('workspace');
  });

  it('rejeita campo desconhecido dentro do item, do storage e do workspace com o caminho', () => {
    expect(fieldOf(withChange((d) => (d.items[1].foo = 'x')))).toBe('items[1].foo');
    expect(fieldOf(withChange((d) => (d.items[0].storage.extra = 1)))).toBe('items[0].storage.extra');
    expect(fieldOf(withChange((d) => (d.workspace.bonus = 1)))).toBe('workspace.bonus');
    expect(fieldOf(withChange((d) => delete d.items[2].note))).toBe('items[2].note');
  });

  it('rejeita `key` duplicada e fora do formato de slug', () => {
    expect(fieldOf(withChange((d) => (d.items[3].key = 'api')))).toBe('items[3].key');
    expect(fieldOf(withChange((d) => (d.items[0].key = 'API Server')))).toBe('items[0].key');
    expect(fieldOf(withChange((d) => (d.items[0].key = '')))).toBe('items[0].key');
    expect(fieldOf(withChange((d) => (d.items[0].key = 'a'.repeat(41))))).toBe('items[0].key');
  });

  it('rejeita `renderKey` inválida e repetida; aceita nula', () => {
    expect(fieldOf(withChange((d) => (d.items[0].renderKey = 'srv-teste')))).toBe('items[0].renderKey');
    expect(fieldOf(withChange((d) => (d.items[5].renderKey = 'worker')))).toBe('items[5].renderKey');
    const parsed = parseInfraCostSettings(withChange((d) => (d.items[0].renderKey = null)));
    expect(parsed.items[0]!.renderKey).toBeNull();
  });

  it('aceita `storage` nulo, `storage.gb` nulo e `storage.usdPerGb` nulo (a confirmar)', () => {
    const parsed = parseInfraCostSettings(
      withChange((d) => {
        d.items[0].storage = { gb: null, usdPerGb: 0.25 };
        d.items[4].storage = { gb: 15, usdPerGb: null };
        d.items[1].storage = null;
      }),
    );
    expect(parsed.items[0]!.storage).toEqual({ gb: null, usdPerGb: 0.25 });
    expect(parsed.items[4]!.storage).toEqual({ gb: 15, usdPerGb: null });
    expect(parsed.items[1]!.storage).toBeNull();
  });

  it('aplica as faixas dos números do item', () => {
    expect(fieldOf(withChange((d) => (d.items[0].monthlyUsd = -1)))).toBe('items[0].monthlyUsd');
    expect(fieldOf(withChange((d) => (d.items[0].monthlyUsd = 100_001)))).toBe('items[0].monthlyUsd');
    expect(fieldOf(withChange((d) => (d.items[0].monthlyUsd = '25')))).toBe('items[0].monthlyUsd');
    expect(fieldOf(withChange((d) => (d.items[1].quantity = 101)))).toBe('items[1].quantity');
    expect(fieldOf(withChange((d) => (d.items[1].quantity = 1.5)))).toBe('items[1].quantity');
    expect(fieldOf(withChange((d) => (d.items[0].storage.gb = 10_001)))).toBe('items[0].storage.gb');
    expect(fieldOf(withChange((d) => (d.items[0].storage.usdPerGb = 10.01)))).toBe('items[0].storage.usdPerGb');
    expect(parseInfraCostSettings(withChange((d) => (d.items[0].monthlyUsd = 100_000))).items[0]!.monthlyUsd).toBe(100_000);
  });

  it('rejeita categoria, cobrança e alocação fora da lista', () => {
    expect(fieldOf(withChange((d) => (d.items[0].category = 'gpu')))).toBe('items[0].category');
    expect(fieldOf(withChange((d) => (d.items[0].billing = 'hourly')))).toBe('items[0].billing');
    expect(fieldOf(withChange((d) => (d.items[0].allocation = 'direct')))).toBe('items[0].allocation');
  });

  it('respeita os limites de lista: 40 itens, 60 planos, 60 modelos', () => {
    const items = withChange((d) => {
      while (d.items.length < INFRA_COST_LIMITS.maxItems) d.items.push(extraItem(d.items.length));
    });
    expect(parseInfraCostSettings(items).items).toHaveLength(40);
    expect(fieldOf(withChange((d) => (d.items = [...items.items, extraItem(99)])))).toBe('items');

    const plans = Array.from({ length: 61 }, (_, i) => ({ resourceType: 'service', plan: `p-${i}`, monthlyUsd: i }));
    expect(parseInfraCostSettings(withChange((d) => (d.renderPlanPrices = plans.slice(0, 60)))).renderPlanPrices).toHaveLength(60);
    expect(fieldOf(withChange((d) => (d.renderPlanPrices = plans)))).toBe('renderPlanPrices');

    const models = Array.from({ length: 61 }, (_, i) => ({ kind: 'OPENAI', model: `m-${i}`, inputPerMTokUsd: 1, outputPerMTokUsd: 2 }));
    expect(parseInfraCostSettings(withChange((d) => (d.aiModelPrices = models.slice(0, 60)))).aiModelPrices).toHaveLength(60);
    expect(fieldOf(withChange((d) => (d.aiModelPrices = models)))).toBe('aiModelPrices');
  });

  it('valida preços por plano e por modelo, sem repetição', () => {
    expect(fieldOf(withChange((d) => (d.renderPlanPrices[0].resourceType = 'disk')))).toBe('renderPlanPrices[0].resourceType');
    expect(fieldOf(withChange((d) => (d.renderPlanPrices[2].plan = '1c-2g')))).toBe('renderPlanPrices[2].plan');
    // mesmo nome de plano em tipos diferentes é permitido (serviço e Postgres têm 1c-2g)
    expect(parseInfraCostSettings(valid()).renderPlanPrices.filter((p) => p.plan === '1c-2g')).toHaveLength(2);
    const price = { kind: 'ANTHROPIC', model: 'modelo-a', inputPerMTokUsd: 3, outputPerMTokUsd: 15 };
    expect(parseInfraCostSettings(withChange((d) => (d.aiModelPrices = [price]))).aiModelPrices).toEqual([price]);
    expect(fieldOf(withChange((d) => (d.aiModelPrices = [price, { ...price }])))).toBe('aiModelPrices[1].model');
    expect(fieldOf(withChange((d) => (d.aiModelPrices = [{ ...price, kind: 'OUTRO' }])))).toBe('aiModelPrices[0].kind');
    expect(fieldOf(withChange((d) => (d.aiModelPrices = [{ ...price, outputPerMTokUsd: -1 }])))).toBe('aiModelPrices[0].outputPerMTokUsd');
  });

  it('valida o workspace, inclusive `cycleStartDay` fora de 1–28', () => {
    expect(fieldOf(withChange((d) => (d.workspace.cycleStartDay = 0)))).toBe('workspace.cycleStartDay');
    expect(fieldOf(withChange((d) => (d.workspace.cycleStartDay = 29)))).toBe('workspace.cycleStartDay');
    expect(fieldOf(withChange((d) => (d.workspace.cycleStartDay = 1.5)))).toBe('workspace.cycleStartDay');
    expect(fieldOf(withChange((d) => (d.workspace.includedBandwidthGb = -5)))).toBe('workspace.includedBandwidthGb');
    expect(fieldOf(withChange((d) => (d.workspace.manualBuildMinutes = 'muito')))).toBe('workspace.manualBuildMinutes');
    expect(fieldOf(withChange((d) => (d.workspace.planLabel = '  ')))).toBe('workspace.planLabel');
    const parsed = parseInfraCostSettings(
      withChange((d) => {
        d.workspace.cycleStartDay = 28;
        d.workspace.manualBandwidthGb = 7;
        d.workspace.manualBuildMinutes = 800;
      }),
    );
    expect(parsed.workspace).toMatchObject({ cycleStartDay: 28, manualBandwidthGb: 7, manualBuildMinutes: 800 });
  });

  it('valida a cotação: método de fechamento, override com faixa, 4 casas e data', () => {
    expect(fieldOf(withChange((d) => (d.fx.closingMethod = 'first_day')))).toBe('fx.closingMethod');
    expect(fieldOf(withChange((d) => (d.fx.auto = 'yes')))).toBe('fx.auto');
    expect(fieldOf(withChange((d) => (d.fx.override = { rate: 0.5, date: '2026-11-10' })))).toBe('fx.override.rate');
    expect(fieldOf(withChange((d) => (d.fx.override = { rate: 21, date: '2026-11-10' })))).toBe('fx.override.rate');
    expect(fieldOf(withChange((d) => (d.fx.override = { rate: 5.12345, date: '2026-11-10' })))).toBe('fx.override.rate');
    expect(fieldOf(withChange((d) => (d.fx.override = { rate: 5.5, date: '2026-02-30' })))).toBe('fx.override.date');
    expect(fieldOf(withChange((d) => (d.fx.override = { rate: 5.5, date: '10/11/2026' })))).toBe('fx.override.date');
    expect(fieldOf(withChange((d) => (d.fx.override = { rate: 5.5, date: '2026-11-10', by: 'x' })))).toBe('fx.override.by');
    const parsed = parseInfraCostSettings(withChange((d) => (d.fx = { auto: false, override: { rate: 5.4321, date: '2026-11-10' }, closingMethod: 'month_average' })));
    expect(parsed.fx).toEqual({ auto: false, override: { rate: 5.4321, date: '2026-11-10' }, closingMethod: 'month_average' });
  });

  it('textos: tira espaços das pontas, vazio opcional vira nulo, limite de tamanho', () => {
    const parsed = parseInfraCostSettings(
      withChange((d) => {
        d.items[0].label = '  API  ';
        d.items[0].note = '   ';
        d.items[0].planLabel = '';
      }),
    );
    expect(parsed.items[0]).toMatchObject({ label: 'API', note: null, planLabel: null });
    expect(fieldOf(withChange((d) => (d.items[0].label = '')))).toBe('items[0].label');
    expect(fieldOf(withChange((d) => (d.items[0].note = 'x'.repeat(281))))).toBe('items[0].note');
  });
});

describe('resolveInfraCostSettings', () => {
  it('sem linha salva: valores iniciais com origem default', () => {
    expect(resolveInfraCostSettings(null)).toEqual({ value: DEFAULT_INFRA_COST_SETTINGS, origin: 'default' });
  });

  it('linha válida: valor salvo com origem saved', () => {
    const saved = withChange((d) => (d.items[1].quantity = 2));
    const resolved = resolveInfraCostSettings({ value: saved });
    expect(resolved.origin).toBe('saved');
    expect(resolved.value.items[1]!.quantity).toBe(2);
  });

  it('linha inválida (gravada fora da API) cai no default', () => {
    expect(resolveInfraCostSettings({ value: 'lixo' }).origin).toBe('default');
    expect(resolveInfraCostSettings({ value: withChange((d) => (d.items[3].key = 'api')) })).toEqual({
      value: DEFAULT_INFRA_COST_SETTINGS,
      origin: 'default',
    });
  });
});
