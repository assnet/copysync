import { describe, expect, it } from 'vitest';
import {
  accountChipLabel, activeFiltersCount, buildPlanMatrix, contextLine, coverageTexts, csvCell, DEFAULT_USAGE_FILTERS,
  earliestFirstDataDay, featureDataSince, featuresTotal, formatCount, formatDay, formatPlanCell, formatReach,
  formatTenantsComparison, formatTrend, granularityOptions, minutesSince, neverUsedFeatures, parseUsageFilters, presetsWithin, rankingSlice,
  resolvePeriod, sortFeatures, summaryCsvFileName, summaryToCsv, toggleKind, toUsageQuery, todayInZone,
  sourceState, topFeatureOf, USAGE_INITIAL_MAX_DAYS, USAGE_MAX_DAYS, usageTrend, validateCustomRange, visibleFeatures, withPeriod,
} from './rules';
import { forgetUsageMaxDays, knownUsageMaxDays, rememberUsageMaxDays } from './usageMaxDays';
import { featureUsageStrings as S } from './strings';
import { summaryFixture } from './testFixtures';
import type { UsageFeatureItem, UsageFilters } from './types';

/** 22:00 de 17/11/2026 em Brasília = 01:00 de 18/11 em UTC. */
const NOW_22H_BRT = Date.UTC(2026, 10, 18, 1, 0, 0);

describe('período em Brasília', () => {
  it('"30 dias" às 22:00 de Brasília usa o dia de Brasília, não o UTC', () => {
    expect(todayInZone(NOW_22H_BRT)).toBe('2026-11-17');
    expect(resolvePeriod(DEFAULT_USAGE_FILTERS, NOW_22H_BRT)).toEqual({ from: '2026-10-19', to: '2026-11-17', days: 30 });
  });

  it('preset salvo não guarda data: relido no dia seguinte resolve para os 30 dias de hoje', () => {
    const saved = parseUsageFilters(JSON.parse(JSON.stringify(DEFAULT_USAGE_FILTERS)), NOW_22H_BRT);
    expect(saved.from).toBeNull();
    const nextDay = NOW_22H_BRT + 86_400_000;
    expect(resolvePeriod(saved, nextDay)).toEqual({ from: '2026-10-20', to: '2026-11-18', days: 30 });
  });

  it('hoje, 7 e 90 dias contam as duas pontas', () => {
    expect(resolvePeriod({ preset: 'today', from: null, to: null }, NOW_22H_BRT)).toEqual({ from: '2026-11-17', to: '2026-11-17', days: 1 });
    expect(resolvePeriod({ preset: '7d', from: null, to: null }, NOW_22H_BRT).from).toBe('2026-11-11');
    expect(resolvePeriod({ preset: '90d', from: null, to: null }, NOW_22H_BRT).from).toBe('2026-08-20');
  });

  it('validateCustomRange recusa 91 dias com teto 90, futuro, ordem invertida e data malformada', () => {
    expect(validateCustomRange('2026-08-19', '2026-11-17', 90, NOW_22H_BRT)).toBe('tooLong');
    expect(validateCustomRange('2026-08-20', '2026-11-17', 90, NOW_22H_BRT)).toBeNull();
    expect(validateCustomRange('2026-11-01', '2026-11-18', 90, NOW_22H_BRT)).toBe('future');
    expect(validateCustomRange('2026-11-10', '2026-11-01', 90, NOW_22H_BRT)).toBe('order');
    expect(validateCustomRange('2026-02-30', '2026-03-01', 90, NOW_22H_BRT)).toBe('invalid');
    expect(validateCustomRange('2026-08-19', '2026-11-17', 400, NOW_22H_BRT)).toBeNull();
  });
});

describe('parseUsageFilters', () => {
  it('JSON inválido, forma antiga e valor fora da lista voltam ao padrão', () => {
    expect(parseUsageFilters('{quebrado', NOW_22H_BRT)).toEqual(DEFAULT_USAGE_FILTERS);
    expect(parseUsageFilters(null, NOW_22H_BRT)).toEqual(DEFAULT_USAGE_FILTERS);
    expect(parseUsageFilters([1, 2], NOW_22H_BRT)).toEqual(DEFAULT_USAGE_FILTERS);
    expect(parseUsageFilters({ range: '30d', resource: 'all' }, NOW_22H_BRT)).toEqual(DEFAULT_USAGE_FILTERS);
    const odd = parseUsageFilters({ ...DEFAULT_USAGE_FILTERS, granularity: 'hora', sort: 'x', tenantStatus: 'FOO', kinds: ['NADA'] }, NOW_22H_BRT);
    expect(odd).toEqual(DEFAULT_USAGE_FILTERS);
  });

  it('preserva o tenantId salvo e devolve "todos" para plano desconhecido', () => {
    const f = parseUsageFilters({ ...DEFAULT_USAGE_FILTERS, tenantId: 'c1a2b3c4d5e6', plan: 'COPYSYNC_ULTRA' }, NOW_22H_BRT);
    expect(f.tenantId).toBe('c1a2b3c4d5e6');
    expect(f.plan).toBe('all');
    expect(parseUsageFilters({ ...DEFAULT_USAGE_FILTERS, plan: 'NONE' }, NOW_22H_BRT).plan).toBe('NONE');
  });

  it('guarda só o tenantId, nenhum nome de conta', () => {
    const f = parseUsageFilters({ ...DEFAULT_USAGE_FILTERS, tenantId: 'abc', tenantName: 'Loja X' }, NOW_22H_BRT);
    expect(JSON.stringify(f)).not.toContain('Loja X');
    expect(Object.keys(f).sort()).toEqual(Object.keys(DEFAULT_USAGE_FILTERS).sort());
  });

  it('personalizado no futuro ou acima do teto volta ao padrão; válido mantém as datas', () => {
    const future = parseUsageFilters({ ...DEFAULT_USAGE_FILTERS, preset: 'custom', from: '2026-11-10', to: '2026-11-20' }, NOW_22H_BRT);
    expect(future.preset).toBe('30d');
    expect(future.from).toBeNull();
    const tooLong = parseUsageFilters({ ...DEFAULT_USAGE_FILTERS, preset: 'custom', from: '2026-01-01', to: '2026-11-01' }, NOW_22H_BRT);
    expect(tooLong.preset).toBe('30d');
    const ok = parseUsageFilters({ ...DEFAULT_USAGE_FILTERS, preset: 'custom', from: '2026-11-01', to: '2026-11-10' }, NOW_22H_BRT);
    expect(ok).toMatchObject({ preset: 'custom', from: '2026-11-01', to: '2026-11-10' });
  });

  it('com teto de 400 dias aceita personalizado longo e troca "dia" por "semana"', () => {
    const f = parseUsageFilters({ ...DEFAULT_USAGE_FILTERS, preset: 'custom', from: '2026-01-01', to: '2026-11-01', granularity: 'day' }, NOW_22H_BRT, 400);
    expect(f.preset).toBe('custom');
    expect(f.granularity).toBe('week');
  });

  it('preset que não é personalizado não leva datas', () => {
    const f = parseUsageFilters({ ...DEFAULT_USAGE_FILTERS, preset: '7d', from: '2026-11-01', to: '2026-11-02' }, NOW_22H_BRT);
    expect(f).toMatchObject({ preset: '7d', from: null, to: null });
  });
});

describe('teto de 400 dias (agregado diário)', () => {
  it('painel aceita até 400 dias, mas antes da primeira resposta assume 90', () => {
    expect(USAGE_MAX_DAYS).toBe(400);
    expect(USAGE_INITIAL_MAX_DAYS).toBe(90);
    forgetUsageMaxDays();
    expect(knownUsageMaxDays()).toBe(90);
    rememberUsageMaxDays(400);
    expect(knownUsageMaxDays()).toBe(400);
    rememberUsageMaxDays(1000);
    expect(knownUsageMaxDays()).toBe(400);
    forgetUsageMaxDays();
  });

  it('"6 meses" e "12 meses" só aparecem quando o teto em vigor comporta', () => {
    expect(presetsWithin(90)).toEqual(['today', '7d', '30d', '90d', 'custom']);
    expect(presetsWithin(400)).toEqual(['today', '7d', '30d', '90d', '180d', '365d', 'custom']);
    expect(presetsWithin(200)).not.toContain('365d');
  });

  it('preset longo salvo volta ao padrão quando o teto atual não comporta, em vez de ir à API e errar', () => {
    const saved = { ...DEFAULT_USAGE_FILTERS, preset: '365d', granularity: 'week' };
    expect(parseUsageFilters(saved, NOW_22H_BRT).preset).toBe('30d');
    expect(parseUsageFilters(saved, NOW_22H_BRT, 90).preset).toBe('30d');
    expect(parseUsageFilters(saved, NOW_22H_BRT, 400)).toMatchObject({ preset: '365d', granularity: 'week' });
    expect(validateCustomRange('2025-10-13', '2026-11-17', 400, NOW_22H_BRT)).toBe('tooLong');
  });

  it('"12 meses" resolve 365 dias até hoje e troca "dia" por "semana"', () => {
    const f = withPeriod(DEFAULT_USAGE_FILTERS, { preset: '365d' }, NOW_22H_BRT);
    expect(f.granularity).toBe('week');
    expect(resolvePeriod(f, NOW_22H_BRT)).toEqual({ from: '2025-11-18', to: '2026-11-17', days: 365 });
    expect(toUsageQuery(f, NOW_22H_BRT)).toMatchObject({ from: '2025-11-18', to: '2026-11-17', granularity: 'week' });
  });
});

describe('fonte e atualização', () => {
  const now = Date.parse('2026-11-17T18:02:11.000Z');
  it('live é sempre indicado; daily só avisa com mais de 1 h sem atualizar', () => {
    expect(sourceState({ source: 'live', freshAt: '2020-01-01T00:00:00.000Z' }, now)).toBe('live');
    expect(sourceState({ source: 'daily', freshAt: '2026-11-17T17:02:11.000Z' }, now)).toBe('fresh');
    expect(sourceState({ source: 'daily', freshAt: '2026-11-17T17:02:10.000Z' }, now)).toBe('stale');
    expect(sourceState({ source: 'daily', freshAt: 'inválido' }, now)).toBe('fresh');
  });

  it('idade do agregado em minutos, horas e dias', () => {
    expect(minutesSince('2026-11-17T15:02:11.000Z', now)).toBe(180);
    expect(minutesSince('2026-11-18T00:00:00.000Z', now)).toBe(0);
    expect(S.context.age(45)).toBe('45 min');
    expect(S.context.age(180)).toBe('3 h');
    expect(S.context.age(60 * 24)).toBe('1 dia');
    expect(S.context.age(60 * 50)).toBe('2 dias');
  });
});

describe('granularidade', () => {
  it('"Dia" desabilitado acima de 90 dias', () => {
    expect(granularityOptions(90).find((o) => o.value === 'day')?.disabled).toBe(false);
    expect(granularityOptions(91).find((o) => o.value === 'day')?.disabled).toBe(true);
    expect(granularityOptions(400).filter((o) => !o.disabled).map((o) => o.value)).toEqual(['week', 'month']);
  });

  it('período de 1 dia: só "Dia" (semana/mês desabilitados) e a granularidade vira "Dia"', () => {
    const opts = granularityOptions(1);
    expect(opts.filter((o) => !o.disabled).map((o) => o.value)).toEqual(['day']);
    expect(opts.find((o) => o.value === 'week')?.reason).toBe('singleDay');
    expect(granularityOptions(2).every((o) => !o.disabled)).toBe(true);
    const f = withPeriod({ ...DEFAULT_USAGE_FILTERS, granularity: 'month' }, { preset: 'today' }, NOW_22H_BRT);
    expect(f.granularity).toBe('day');
  });

  it('trocar para período acima de 90 dias muda "Dia" para "Semana"', () => {
    const f = withPeriod(DEFAULT_USAGE_FILTERS, { preset: 'custom', from: '2026-05-01', to: '2026-11-01' }, NOW_22H_BRT);
    expect(f.granularity).toBe('week');
    const g = withPeriod({ ...DEFAULT_USAGE_FILTERS, preset: 'custom', from: '2026-11-01', to: '2026-11-02' }, { preset: '7d' }, NOW_22H_BRT);
    expect(g).toMatchObject({ preset: '7d', from: null, to: null, granularity: 'day' });
  });
});

describe('toUsageQuery', () => {
  it('padrão de DEFAULT_USAGE_FILTERS é o do schema da rota (design §5)', () => {
    expect(DEFAULT_USAGE_FILTERS).toEqual({
      preset: '30d', from: null, to: null, granularity: 'day', product: 'all', kinds: ['ACTION', 'AUTOMATIC'],
      plan: 'all', tenantStatus: 'ACTIVE', includeInternal: false, tenantId: null, sort: 'tenants', recurringDays: 3,
    });
  });

  it('envia todos os filtros explícitos, inclusive os que estão no padrão', () => {
    expect(toUsageQuery(DEFAULT_USAGE_FILTERS, NOW_22H_BRT)).toEqual({
      from: '2026-10-19', to: '2026-11-17', granularity: 'day', kind: 'ACTION,AUTOMATIC',
      tenantStatus: 'ACTIVE', includeInternal: 'false',
    });
  });

  it('produto, plano e conta escolhidos entram na query; ordenação e preset não', () => {
    const f: UsageFilters = { ...DEFAULT_USAGE_FILTERS, product: 'SAVER', plan: 'SAVER_PRO', tenantId: 't1', includeInternal: true, kinds: ['AUDIENCE', 'ACTION'] };
    const q = toUsageQuery(f, NOW_22H_BRT);
    expect(q).toMatchObject({ product: 'SAVER', plan: 'SAVER_PRO', tenantId: 't1', includeInternal: 'true', kind: 'ACTION,AUDIENCE' });
    expect(q).not.toHaveProperty('sort');
    expect(q).not.toHaveProperty('preset');
    expect(q).not.toHaveProperty('limit');
    expect(q).not.toHaveProperty('offset');
  });

  it('toggleKind nunca deixa a lista vazia', () => {
    expect(toggleKind(['ACTION'], 'ACTION')).toEqual(['ACTION']);
    expect(toggleKind(['ACTION'], 'ACCESS')).toEqual(['ACTION', 'ACCESS']);
    expect(toggleKind(['ACTION', 'AUTOMATIC'], 'ACTION')).toEqual(['AUTOMATIC']);
  });

  it('conta os filtros fora do padrão para a gaveta', () => {
    expect(activeFiltersCount(DEFAULT_USAGE_FILTERS)).toBe(0);
    expect(activeFiltersCount({ ...DEFAULT_USAGE_FILTERS, plan: 'NONE', tenantId: 'x', sort: 'uses' })).toBe(2);
  });
});

describe('recorte por plano', () => {
  it('com SAVER_PRO a tela só espera recursos do Saver', () => {
    const s = summaryFixture();
    const keys = visibleFeatures(s.features, { ...DEFAULT_USAGE_FILTERS, plan: 'SAVER_PRO', kinds: ['ACTION', 'AUTOMATIC', 'AUDIENCE', 'ACCESS'] }).map((f) => f.key);
    expect(keys).toEqual(['saver_extraction']);
  });

  it('NONE mantém as duas famílias e COPYSYNC_MAX esconde o Saver', () => {
    const s = summaryFixture();
    const all = { ...DEFAULT_USAGE_FILTERS, kinds: ['ACTION', 'AUTOMATIC', 'AUDIENCE', 'ACCESS'] } as UsageFilters;
    expect(visibleFeatures(s.features, { ...all, plan: 'NONE' })).toHaveLength(s.features.length);
    expect(visibleFeatures(s.features, { ...all, plan: 'COPYSYNC_MAX' }).some((f) => f.planFamily === 'SAVER')).toBe(false);
  });

  it('filtro de tipo tira recurso sem nenhum tipo escolhido', () => {
    const s = summaryFixture();
    expect(visibleFeatures(s.features, DEFAULT_USAGE_FILTERS).some((f) => f.key === 'link_rotation_click')).toBe(false);
  });

  it('matriz usa population.byPlan como denominador, sem somar famílias, e "—" com 0 contas', () => {
    const s = summaryFixture();
    const aff = buildPlanMatrix(s, 'AFFILIATES');
    expect(aff.columns.map((c) => c.plan)).toEqual(['COPYSYNC_LITE', 'COPYSYNC_PRO', 'COPYSYNC_MAX', 'NONE']);
    expect(aff.rows.some((r) => r.key === 'saver_extraction')).toBe(false);
    const gen = aff.rows.find((r) => r.key === 'offer_generator');
    expect(gen?.cells.find((c) => c.plan === 'COPYSYNC_MAX')).toMatchObject({ tenants: 4, activeTenants: 4, uses: 241, share: 1 });
    for (const row of aff.rows) {
      const f = s.features.find((x) => x.key === row.key)!;
      for (const cell of row.cells) {
        const line = f.byPlan.find((b) => b.plan === cell.plan);
        if (line) expect(cell.tenants).toBe(line.tenants);
      }
    }
    const saver = buildPlanMatrix(s, 'SAVER');
    expect(saver.columns).toEqual([
      { plan: 'SAVER_LITE', tenants: 0 }, { plan: 'SAVER_PRO', tenants: 2 }, { plan: 'SAVER_MAX', tenants: 0 }, { plan: 'NONE', tenants: 13 },
    ]);
    const lite = saver.rows[0].cells[0];
    expect(lite.share).toBeNull();
    expect(formatPlanCell(lite)).toBe('—');
    expect(formatPlanCell(saver.rows[0].cells[1])).toBe('2 de 2');
  });

  it('coluna "sem plano" só aparece quando há conta sem plano na família', () => {
    const s = summaryFixture();
    s.population.byPlan = s.population.byPlan.filter((p) => !(p.family === 'AFFILIATES' && p.plan === 'NONE'));
    expect(buildPlanMatrix(s, 'AFFILIATES').columns.map((c) => c.plan)).not.toContain('NONE');
  });
});

describe('tendência e comparação', () => {
  it('anterior null vira "sem base de comparação"', () => {
    expect(formatTrend(usageTrend(10, null))).toBe(S.comparison.noBase);
    expect(formatTenantsComparison(9, null)).toBe(S.comparison.noBase);
  });

  it('formata alta, queda, igual e novo', () => {
    expect(formatTrend(usageTrend(412, 350))).toBe('+18%');
    expect(formatTrend(usageTrend(50, 100))).toBe('-50%');
    expect(formatTrend(usageTrend(5, 5))).toBe(S.comparison.flat);
    expect(formatTrend(usageTrend(5, 0))).toBe(S.comparison.newUse);
    expect(formatTenantsComparison(12, 10)).toBe('+2 contas');
    expect(formatTenantsComparison(9, 10)).toBe('-1 conta');
  });
});

describe('ranking', () => {
  const f = (key: string, uses: number, activeTenants: number, usesPrevious: number | null) =>
    ({ key, uses, activeTenants, usesPrevious }) as Pick<UsageFeatureItem, 'key' | 'uses' | 'activeTenants' | 'usesPrevious'>;
  const list = [f('b', 10, 3, null), f('a', 10, 3, 5), f('c', 500, 1, 600), f('d', 2, 5, 0)];

  it('padrão por contas, desempate por usos e depois pela chave', () => {
    expect(sortFeatures(list, 'tenants').map((x) => x.key)).toEqual(['d', 'a', 'b', 'c']);
  });

  it('por usos, desempate por contas e chave', () => {
    expect(sortFeatures(list, 'uses').map((x) => x.key)).toEqual(['c', 'a', 'b', 'd']);
  });

  it('por tendência: novo primeiro, sem base por último', () => {
    expect(sortFeatures(list, 'trend').map((x) => x.key)).toEqual(['d', 'a', 'c', 'b']);
  });

  it('não altera a lista recebida e corta em 12 + "ver todos"', () => {
    const copy = [...list];
    sortFeatures(list, 'uses');
    expect(list).toEqual(copy);
    const many = Array.from({ length: 15 }, (_, i) => i);
    expect(rankingSlice(many)).toEqual({ visible: many.slice(0, 12), hidden: 3 });
  });

  it('nunca usados, total "x de N" e mais usado vêm do resumo', () => {
    const s = summaryFixture();
    expect(neverUsedFeatures(s.features).map((x) => x.key)).toEqual(['telegram_session']);
    expect(featuresTotal(s.totals)).toBe(5);
    expect(topFeatureOf(s)?.key).toBe('offer_generator');
  });
});

describe('cobertura e dados desde', () => {
  it('"dados desde" usa firstDataDay, nunca dataFrom', () => {
    const s = summaryFixture();
    const clicks = s.features.find((x) => x.key === 'link_rotation_click')!;
    expect(clicks.firstDataDay).not.toBe(clicks.dataFrom);
    expect(featureDataSince(clicks)).toBe(S.coverage.dataSince('01/07/2026'));
    expect(earliestFirstDataDay(s.features)).toBe('2026-03-02');
    expect(featureDataSince({ firstDataDay: null })).toBe(S.coverage.noData);
  });

  it('dois códigos = dois textos, retenção com os dias', () => {
    const s = summaryFixture();
    const texts = coverageTexts(s.features.find((x) => x.key === 'link_rotation_click')!);
    expect(texts).toHaveLength(2);
    expect(texts[1]).toContain('90 dias');
  });

  it('texto de MIXED_TRIGGERS diz que inclui os disparados à mão', () => {
    expect(S.coverageReasons.MIXED_TRIGGERS).toMatch(/à mão/);
  });

  it('linha de contexto em Brasília', () => {
    expect(contextLine({ firstDataDay: '2026-10-26', freshAt: '2026-11-17T18:02:11.000Z' }))
      .toBe('Dias no horário de Brasília · dados desde 26/10/2026 · atualizado às 15:02');
  });
});

describe('formatação', () => {
  it('números, alcance e datas em pt-BR', () => {
    expect(formatCount(89)).toBe('89');
    expect(formatCount(1234)).toBe('1.234');
    expect(formatCount(24_000).replace(/\u00a0/g, ' ')).toBe('24 mil');
    expect(formatReach(0.5333)).toBe('53%');
    expect(formatReach(0.05)).toBe('5%');
    expect(formatReach(0.053)).toBe('5,3%');
    expect(formatReach(null)).toBe('—');
    expect(formatDay('2026-11-17')).toBe('17/11');
    expect(formatDay(null)).toBe('—');
  });

  it('chip da conta: nome carregado ou id curto', () => {
    expect(accountChipLabel('1a2b3c4d5e6f', 'Loja X')).toBe('Loja X');
    expect(accountChipLabel('1a2b3c4d5e6f')).toBe('Conta 1a2b3c4d');
    expect(accountChipLabel('1a2b3c4d5e6f', '  ')).toBe('Conta 1a2b3c4d');
  });
});

describe('CSV do resumo', () => {
  it('BOM, ponto e vírgula, sem coluna de conta, uma linha por recurso', () => {
    const s = summaryFixture();
    const csv = summaryToCsv(s);
    expect(csv.startsWith('﻿')).toBe(true);
    const lines = csv.slice(1).trimEnd().split('\r\n');
    expect(lines[0]).toBe(S.csv.columns.join(';'));
    expect(lines).toHaveLength(s.features.length + 1);
    expect(csv).not.toMatch(/conta;|tenantId|tenantName/i);
    expect(lines[1]).toBe('Gerador de ofertas;Afiliados;Ação;412;8;53%;\'+18%;15/11/2026');
  });

  it('neutraliza =, +, - e @ e escapa ; e aspas', () => {
    expect(csvCell('=SOMA(A1)')).toBe("'=SOMA(A1)");
    expect(csvCell('+1')).toBe("'+1");
    expect(csvCell('-1')).toBe("'-1");
    expect(csvCell('@x')).toBe("'@x");
    expect(csvCell('a;b')).toBe('"a;b"');
    expect(csvCell('diz "oi"')).toBe('"diz ""oi"""');
  });

  it('nome do arquivo pelo período', () => {
    expect(summaryCsvFileName({ from: '2026-08-18', to: '2026-11-15' })).toBe('uso-dos-recursos_2026-08-18_2026-11-15.csv');
  });
});

describe('textos', () => {
  it('nenhuma string com o nome da marca', () => {
    // Só os valores exibidos: as chaves de plano (`COPYSYNC_LITE`) são slugs da API, não texto.
    const values = (v: unknown): string[] =>
      typeof v === 'string' ? [v]
        : typeof v === 'function' ? [String(v('X', 'Y', 'Z', 'W', 'V'))]
          : v && typeof v === 'object' ? Object.values(v).flatMap(values) : [];
    for (const text of values(S)) expect(text.toLowerCase()).not.toMatch(/copysync|waioprime/);
  });

  it('cobre cada bloco de tela do design §7', () => {
    for (const block of ['tabs', 'filters', 'context', 'kpis', 'ranking', 'trend', 'neverUsed', 'coverage', 'plansTab', 'detail', 'tenants', 'csv', 'states', 'errors', 'periodErrors'] as const) {
      expect(S[block], block).toBeTruthy();
    }
    expect(S.navLabel).toBe('Uso dos recursos');
  });

  it('formata dia completo', () => {
    expect(formatDay('2026-11-17', true)).toBe('17/11/2026');
  });
});
