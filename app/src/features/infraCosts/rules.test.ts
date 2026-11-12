import { describe, expect, it } from 'vitest';
import { PLAN_CATALOG } from '@/features/plans/catalog';
import {
  catalogSlugOf,
  diffSettings,
  draftToSettings,
  formatBrl,
  formatPercent,
  formatUsd,
  planMargin,
  toSettingsPayload,
  validateSettingsDraft,
} from './rules';
import { sampleSettings } from './testFixtures';
import type { InfraCostSettingsDraft } from './types';

const norm = (s: string) => s.replace(/\s/g, ' ');

describe('formatação de valores', () => {
  it('mostra 2 casas em US$ e R$', () => {
    expect(norm(formatUsd(120.25))).toBe('US$ 120,25');
    expect(norm(formatBrl(1234.5))).toBe('R$ 1.234,50');
  });

  it('mostra 4 casas abaixo de 0,01 (custo por sessão-hora)', () => {
    expect(norm(formatUsd(0.004567))).toBe('US$ 0,0046');
    expect(norm(formatUsd(0))).toBe('US$ 0,00');
  });

  it('arredonda meio para cima sem erro binário', () => {
    expect(norm(formatUsd(1.005))).toBe('US$ 1,01');
    expect(norm(formatBrl(2.675))).toBe('R$ 2,68');
  });

  it('sem cotação (BRL nulo) mostra traço', () => {
    expect(formatBrl(null)).toBe('—');
    expect(formatUsd(undefined)).toBe('—');
  });

  it('percentual com 1 casa', () => {
    expect(formatPercent(12.345)).toBe('12,3%');
    expect(formatPercent(null)).toBe('—');
  });
});

describe('margem por plano', () => {
  const lite = PLAN_CATALOG.find((p) => p.slug === 'lite')!;

  it('mapeia o slug do domínio para o catálogo', () => {
    expect(catalogSlugOf('COPYSYNC_LITE')).toBe('lite');
    expect(catalogSlugOf('COPYSYNC_MAX')).toBe('max');
    expect(catalogSlugOf(null)).toBeNull();
    expect(catalogSlugOf('OUTRO')).toBeNull();
  });

  it('com cotação: mensal e anual-equivalente contra a vitrine', () => {
    const m = planMargin('COPYSYNC_LITE', 30)!;
    expect(m.slug).toBe('lite');
    expect(m.monthly.priceBrl).toBe(lite.price);
    expect(m.monthly.marginBrl).toBe(lite.price - 30);
    expect(m.monthly.marginPct).toBeCloseTo(((lite.price - 30) / lite.price) * 100, 6);
    expect(m.annual.priceBrl).toBe(lite.priceAnnualMonthly);
    expect(m.annual.marginBrl).toBe(lite.priceAnnualMonthly - 30);
  });

  it('sem cotação (custo em R$ nulo) não há margem', () => {
    expect(planMargin('COPYSYNC_LITE', null)).toBeNull();
  });

  it('plano fora do catálogo ou sem plano não tem margem', () => {
    expect(planMargin('COPYSYNC_ENTERPRISE', 10)).toBeNull();
    expect(planMargin(null, 10)).toBeNull();
  });

  it('aceita catálogo injetado e margem negativa', () => {
    const m = planMargin('pro', 300, [{ ...lite, slug: 'pro', price: 200, priceAnnualMonthly: 0 }])!;
    expect(m.monthly.marginBrl).toBe(-100);
    expect(m.annual.marginPct).toBeNull();
  });
});

describe('rascunho de preços', () => {
  it('rascunho com números em texto vira configuração', () => {
    const draft = sampleSettings() as InfraCostSettingsDraft;
    draft.items[0].monthlyUsd = '26,5';
    draft.fx.override = { rate: '5,4321', date: '2026-11-12' };
    const s = draftToSettings(draft)!;
    expect(s.items[0].monthlyUsd).toBe(26.5);
    expect(s.fx.override).toEqual({ rate: 5.4321, date: '2026-11-12' });
    expect(validateSettingsDraft(draft)).toEqual({});
  });

  it('erro por caminho: faixa, obrigatório, casas da cotação e data', () => {
    const draft = sampleSettings() as InfraCostSettingsDraft;
    draft.items[1].quantity = '101';
    draft.items[0].monthlyUsd = '';
    draft.fx.override = { rate: '5,12345', date: '2026-02-30' };
    draft.workspace.cycleStartDay = '29';
    const errors = validateSettingsDraft(draft);
    expect(Object.keys(errors).sort()).toEqual([
      'fx.override.date', 'fx.override.rate', 'items[0].monthlyUsd', 'items[1].quantity', 'workspace.cycleStartDay',
    ]);
    expect(draftToSettings(draft)).toBeNull();
  });

  it('armazenamento e consumo manual vazios viram nulo (a confirmar)', () => {
    const draft = sampleSettings() as InfraCostSettingsDraft;
    draft.items[0].storage = { gb: '', usdPerGb: null };
    draft.workspace.manualBandwidthGb = '';
    const s = draftToSettings(draft)!;
    expect(s.items[0].storage).toEqual({ gb: null, usdPerGb: null });
    expect(s.workspace.manualBandwidthGb).toBeNull();
  });

  it('chave repetida, formato de chave, opção inválida e plano repetido', () => {
    const draft = sampleSettings() as InfraCostSettingsDraft;
    draft.items[1].key = 'api';
    draft.items[2].key = 'E-mail';
    draft.items[2].renderKey = 'cdn' as never;
    draft.renderPlanPrices[1].plan = '0.5c-512mb';
    const errors = validateSettingsDraft(draft);
    expect(errors['items[1].key']).toBeDefined();
    expect(errors['items[2].key']).toBeDefined();
    expect(errors['items[2].renderKey']).toBeDefined();
    expect(errors['renderPlanPrices[1].plan']).toBeDefined();
  });

  it('renderKey repetida, quantidade fracionada e observação longa (regras da API)', () => {
    const draft = sampleSettings() as InfraCostSettingsDraft;
    draft.items[1].renderKey = 'api';
    draft.items[0].quantity = '1,5';
    draft.items[2].note = 'x'.repeat(281);
    draft.aiModelPrices.push({ ...draft.aiModelPrices[0] });
    const errors = validateSettingsDraft(draft);
    expect(Object.keys(errors).sort()).toEqual([
      'aiModelPrices[1].model', 'items[0].quantity', 'items[1].renderKey', 'items[2].note',
    ]);
  });

  it('texto opcional vazio vira nulo; nome do plano do workspace é obrigatório', () => {
    const draft = sampleSettings() as InfraCostSettingsDraft;
    draft.items[0].note = '   ';
    draft.items[0].planLabel = '';
    const s = draftToSettings(draft)!;
    expect(s.items[0].note).toBeNull();
    expect(s.items[0].planLabel).toBeNull();
    draft.workspace.planLabel = '';
    expect(validateSettingsDraft(draft)).toHaveProperty(['workspace.planLabel']);
  });

  it('limite de 40 itens', () => {
    const draft = sampleSettings() as InfraCostSettingsDraft;
    draft.items = Array.from({ length: 41 }, (_, i) => ({ ...draft.items[2], key: `item-${i}` }));
    expect(validateSettingsDraft(draft).items).toBeDefined();
  });
});

describe('diff da confirmação', () => {
  it('lista campos alterados, linhas incluídas e removidas pela identidade', () => {
    const before = sampleSettings();
    const after = sampleSettings();
    after.items[0].monthlyUsd = 7;
    after.items.reverse();
    after.items = after.items.filter((i) => i.key !== 'email');
    after.items.push({ ...before.items[2], key: 'r2', label: 'Armazenamento de mídia', billing: 'usage', monthlyUsd: 0 });
    after.fx.override = { rate: 5.4, date: '2026-11-12' };
    const diff = diffSettings(before, after);
    expect(diff).toContainEqual({ kind: 'changed', path: 'items[api].monthlyUsd', from: 25, to: 7 });
    expect(diff).toContainEqual({ kind: 'changed', path: 'fx.override.rate', from: null, to: 5.4 });
    expect(diff).toContainEqual({ kind: 'added', path: 'items[r2]', from: null, to: 'Armazenamento de mídia' });
    expect(diff).toContainEqual({ kind: 'removed', path: 'items[email]', from: 'E-mail', to: null });
    expect(diff.filter((d) => d.path.startsWith('items[r2].') || d.path.startsWith('items[email].'))).toEqual([]);
    expect(diff.some((d) => d.path.startsWith('items[worker]'))).toBe(false);
  });

  it('sem mudança não gera linha; remover a cotação manual aparece', () => {
    const before = sampleSettings();
    before.fx.override = { rate: 5, date: '2026-11-01' };
    expect(diffSettings(before, structuredClone(before))).toEqual([]);
    const after = structuredClone(before);
    after.fx.override = null;
    expect(diffSettings(before, after)).toEqual([
      { kind: 'changed', path: 'fx.override.rate', from: 5, to: null },
      { kind: 'changed', path: 'fx.override.date', from: '2026-11-01', to: null },
    ]);
  });
});

describe('payload do PUT', () => {
  it('descarta campos fora do contrato (nenhum preço de plano sai do painel)', () => {
    const s = sampleSettings();
    const dirty = { ...s, price: 97, items: s.items.map((i) => ({ ...i, priceAnnualMonthly: 77 })) };
    const payload = toSettingsPayload(dirty as never);
    expect(payload).toEqual(s);
    expect(JSON.stringify(payload)).not.toMatch(/"price/);
  });
});
