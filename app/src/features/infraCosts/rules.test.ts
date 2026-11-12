import { describe, expect, it } from 'vitest';
import { PLAN_CATALOG } from '@/features/plans/catalog';
import {
  catalogPlanName,
  changeLabel,
  changeValue,
  countErrors,
  draftNumberText,
  hasThousandsDot,
  isConflictPath,
  listEntryOfPath,
  mergeSettings,
  nextIndexAfterRemoval,
  parseDraftNumber,
  renameOpenKey,
  catalogSlugOf,
  dayLabel,
  diffSettings,
  fieldLabel,
  monthLabel,
  perSessionByBasis,
  planRowsByBasis,
  warningDetail,
  draftToSettings,
  formatBrl,
  formatPercent,
  formatUsd,
  planMargin,
  toSettingsPayload,
  validateSettingsDraft,
} from './rules';
import { infraCostsStrings as S } from './strings';
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

describe('fieldLabel', () => {
  const settings = sampleSettings();
  it('item pelo índice (400) ou pela identidade (diff): "Rótulo · Campo"', () => {
    expect(fieldLabel('items[0].monthlyUsd', settings)).toBe('API · Preço (US$/mês)');
    expect(fieldLabel('items[email].monthlyUsd', settings)).toBe('E-mail · Preço (US$/mês)');
    expect(fieldLabel('items[api].storage.gb', settings)).toBe('API · Disco (GB)');
  });
  it('linha sem campo e listas de preços', () => {
    expect(fieldLabel('items[worker]', settings)).toBe('Serviços · Worker');
    expect(fieldLabel('renderPlanPrices[1].monthlyUsd', settings)).toBe('Serviço 1c-2g · Preço (US$/mês)');
    expect(fieldLabel('renderPlanPrices[postgres:0.5c-1g]', settings)).toBe('Preços por plano da Render · Postgres 0.5c-1g');
    expect(fieldLabel('aiModelPrices[0].inputPerMTokUsd', settings)).toMatch(/gpt-x · Entrada \(US\$\/1M\)$/);
  });
  it('fora das listas: seção e campo', () => {
    expect(fieldLabel('workspace.planLabel', settings)).toBe('Workspace · Plano do workspace');
    expect(fieldLabel('fx.override.rate', settings)).toBe('Cotação do dólar · Cotação manual · Reais por US$ 1');
    expect(fieldLabel('items', settings)).toBe('Serviços');
  });
  it('sem configuração usa o identificador; caminho desconhecido volta igual', () => {
    expect(fieldLabel('items[api].quantity', null)).toBe('api · Quantidade');
    expect(fieldLabel('outro.campo', null)).toBe('outro.campo');
  });
});

describe('resumo: datas, base e avisos', () => {
  it('mês e dia', () => {
    expect(monthLabel('2026-11')).toBe('novembro de 2026');
    expect(dayLabel('2026-11-03')).toBe('03/11/2026');
    expect(dayLabel('x')).toBe('x');
  });

  const m = (usd: number) => ({ usd, brl: usd * 5 });
  const plans = [
    { planSlug: 'COPYSYNC_MAX', tenants: 1, contractedSessions: 10, connectedSessions: 6, share: m(55), costPerTenant: m(55), connectedShare: m(66), connectedCostPerTenant: m(66) },
    { planSlug: 'COPYSYNC_LITE', tenants: 5, contractedSessions: 10, connectedSessions: 4, share: m(55), costPerTenant: m(11), connectedShare: m(44), connectedCostPerTenant: m(8.8) },
  ];

  it('planos na ordem do catálogo, base do filtro nos números e margem sempre na contratadas', () => {
    const rows = planRowsByBasis(plans, { basis: 'connected', plan: 'all' });
    expect(rows.map((r) => r.plan.planSlug)).toEqual(['COPYSYNC_LITE', 'COPYSYNC_MAX']);
    expect(rows[0]).toMatchObject({ sessions: 4, share: m(44), perTenant: m(8.8), marginCost: m(11) });
    const contracted = planRowsByBasis(plans, { basis: 'contracted', plan: 'max' });
    expect(contracted).toHaveLength(1);
    expect(contracted[0]).toMatchObject({ sessions: 10, perTenant: m(55), marginCost: m(55) });
  });

  it('custo por sessão da base escolhida', () => {
    const perSession = {
      contracted: { sessions: 20, perSession: m(1), unlimitedTenants: 0 },
      connected: { sessions: 5, perSession: m(4), unallocatedSessions: null, unallocatedCost: null },
    };
    expect(perSessionByBasis({ perSession }, 'contracted').sessions).toBe(20);
    expect(perSessionByBasis({ perSession }, 'connected').sessions).toBe(5);
  });

  it('nome do plano do filtro igual ao da tabela', () => {
    expect(PLAN_CATALOG.map((p) => catalogPlanName(p.slug))).toEqual(['LITE', 'PRO', 'MAX']);
  });

  it('detalhe do aviso com rótulo do item e nome do campo', () => {
    const items = [{ key: 'db', label: 'Banco', renderKey: 'postgres' as const }];
    expect(warningDetail({ code: 'storage_to_confirm', key: 'db', field: 'storage.gb' }, items)).toBe('Banco · Disco (GB)');
    expect(warningDetail({ code: 'plan_without_price', resourceKey: 'postgres', plan: '1c-2g' }, items)).toBe('serviço Banco, plano 1c-2g');
    expect(warningDetail({ code: 'plan_without_price', resourceKey: 'redis', plan: 'x' }, items)).toBe('serviço Redis, plano x');
    expect(warningDetail({ code: 'unlimited_contracted', count: 2 }, items)).toBe('2 ocorrências');
    expect(warningDetail({ code: 'sessions_sample_stale' }, items)).toBeNull();
  });
});

describe('revisão da aba Preços', () => {
  it('número pt-BR: vírgula decimal, ponto de milhar recusado, input com vírgula', () => {
    expect(parseDraftNumber('30,5')).toBe(30.5);
    expect(parseDraftNumber('0.25')).toBe(0.25);
    expect(parseDraftNumber('1.000')).toBeNull();
    expect(hasThousandsDot('12.500.000')).toBe(true);
    expect(hasThousandsDot('1.5')).toBe(false);
    expect(draftNumberText(0.25)).toBe('0,25');
    expect(draftNumberText('3.')).toBe('3.');
    expect(draftNumberText(null)).toBe('');
    const draft = sampleSettings() as InfraCostSettingsDraft;
    draft.workspace.includedBuildMinutes = '1.000';
    expect(validateSettingsDraft(draft)['workspace.includedBuildMinutes']).toBe(S.pricesReview.thousandsDot);
  });

  it('changeLabel usa o salvo para linha removida; changeValue mostra moeda e opções', () => {
    const before = sampleSettings();
    const after = { ...sampleSettings(), items: sampleSettings().items.slice(0, 2) };
    expect(changeLabel('items[email]', before, after)).toBe(`${S.prices.items.title} · E-mail`);
    expect(changeLabel('items[api].monthlyUsd', before, after)).toBe(`API · ${S.prices.items.fields.monthlyUsd}`);
    expect(norm(changeValue('items[api].monthlyUsd', 30.5))).toBe('US$ 30,50');
    expect(norm(changeValue('aiModelPrices[OPENAI:gpt-x].inputPerMTokUsd', 0.155))).toBe('US$ 0,155');
    expect(changeValue('workspace.cycleStartDay', 5)).toBe('5');
    expect(changeValue('items[api].billing', 'fixed')).toBe(S.billing.fixed);
    expect(changeValue('fx.auto', true)).toBe(S.prices.yes);
    expect(changeValue('items[api].note', null)).toBe(S.noValue);
  });

  it('countErrors, listEntryOfPath, nextIndexAfterRemoval e renameOpenKey', () => {
    const errors = { 'items[0].label': 'x', 'items[0].storage.gb': 'x', 'items[1].key': 'x', items: 'x', 'workspace.planLabel': 'x' };
    expect(countErrors(errors, 'items[0]')).toBe(2);
    expect(countErrors(errors, 'items')).toBe(4);
    expect(listEntryOfPath('items[3].storage.gb')).toEqual({ list: 'items', index: 3 });
    expect(listEntryOfPath('workspace.planLabel')).toBeNull();
    expect(nextIndexAfterRemoval(3, 0)).toBe(0);
    expect(nextIndexAfterRemoval(3, 2)).toBeNull();
    expect(renameOpenKey(['api', ''], '', 'backup', ['api', 'backup'])).toEqual(['api', 'backup']);
    expect(renameOpenKey(['', 'api'], '', 'b', ['api', 'b', ''])).toEqual(['', 'api', 'b']);
    expect(renameOpenKey(['api'], 'worker', 'w', ['api', 'w'])).toEqual(['api']);
  });
});

describe('mergeSettings (409)', () => {
  it('aplica só o que mudou no rascunho sobre o salvo novo, por identidade de linha', () => {
    const base = sampleSettings();
    const theirs = sampleSettings();
    theirs.items[2].monthlyUsd = 30;
    theirs.items.reverse(); // reordenar não pode trocar valores entre linhas
    theirs.renderPlanPrices.push({ resourceType: 'key_value', plan: 'starter', monthlyUsd: 10 });
    const mine = sampleSettings();
    mine.items[0].quantity = 2;
    mine.workspace.planLabel = 'Pro';
    mine.aiModelPrices = [];
    const { settings, conflicts } = mergeSettings(base, mine, theirs);
    expect(conflicts).toEqual([]);
    expect(settings.items.find((i) => i.key === 'email')?.monthlyUsd).toBe(30);
    expect(settings.items.find((i) => i.key === 'api')?.quantity).toBe(2);
    expect(settings.workspace.planLabel).toBe('Pro');
    expect(settings.renderPlanPrices.map((r) => r.plan)).toContain('starter');
    expect(settings.aiModelPrices).toEqual([]);
  });

  it('mesmo caminho dos dois lados com valores diferentes = conflito, fica o meu', () => {
    const base = sampleSettings();
    const theirs = sampleSettings();
    theirs.items[2].monthlyUsd = 30;
    theirs.fx.override = { rate: 5, date: '2026-11-01' };
    const mine = sampleSettings();
    mine.items[2].monthlyUsd = 40;
    mine.fx.override = { rate: 5.2, date: '2026-11-01' };
    const { settings, conflicts } = mergeSettings(base, mine, theirs);
    expect(conflicts).toEqual(['fx.override', 'items[email].monthlyUsd']);
    expect(isConflictPath('fx.override.rate', conflicts)).toBe(true);
    expect(settings.items[2].monthlyUsd).toBe(40);
    expect(settings.fx.override).toEqual({ rate: 5.2, date: '2026-11-01' });
    expect(isConflictPath('items[email].monthlyUsd', conflicts)).toBe(true);
    expect(isConflictPath('items[api].monthlyUsd', conflicts)).toBe(false);
  });

  it('remoção de um lado com alteração do outro = conflito; remoção sem alteração sai', () => {
    const base = sampleSettings();
    const theirs = sampleSettings();
    theirs.items = theirs.items.filter((i) => i.key !== 'worker');
    theirs.items[1].monthlyUsd = 30; // email
    const mine = sampleSettings();
    mine.items = mine.items.filter((i) => i.key !== 'email');
    const { settings, conflicts } = mergeSettings(base, mine, theirs);
    expect(conflicts).toEqual(['items[email]']);
    expect(settings.items.map((i) => i.key)).toEqual(['api']);
    expect(isConflictPath('items[email]', conflicts)).toBe(true);
  });
});
