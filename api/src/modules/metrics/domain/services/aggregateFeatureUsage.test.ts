import { describe, expect, it } from 'vitest';
import {
  type AggregateFeatureUsageInput,
  type FeatureUsageFilters,
  type FeatureUsageRow,
  type UsageTenantEntry,
  aggregateFeatureUsage,
  rankFeatureTenants,
} from './aggregateFeatureUsage';
import { FEATURE_USAGE_CATALOG, type FeatureUsageKind } from './featureUsageCatalog';
import { bucketOf, resolveUsagePeriod } from './featureUsagePeriod';

const NOW = new Date('2026-11-17T15:00:00.000Z'); // 12:00 em Brasília
const P30 = resolveUsagePeriod({ from: '2026-10-19', to: '2026-11-17', granularity: 'day', now: NOW, maxDays: 90 });

const T = (tenantId: string, affiliatesPlan: string, saverPlan: string, extra: Partial<UsageTenantEntry> = {}): UsageTenantEntry => ({
  tenantId,
  affiliatesPlan,
  saverPlan,
  status: 'ACTIVE',
  internal: false,
  ...extra,
});

const TENANTS: UsageTenantEntry[] = [
  T('t1', 'COPYSYNC_MAX', 'NONE'),
  T('t2', 'COPYSYNC_LITE', 'SAVER_PRO'),
  T('t3', 'NONE', 'SAVER_PRO'), // só Saver
  T('t4', 'COPYSYNC_PRO', 'NONE', { internal: true }),
  T('t5', 'COPYSYNC_LITE', 'NONE', { status: 'SUSPENDED' }),
];

const FIRST: Record<string, string | null> = Object.fromEntries(FEATURE_USAGE_CATALOG.map((f) => [f.key, '2026-01-01']));
FIRST.panel_login = '2026-10-08'; // 40 dias atrás
FIRST.telegram_session = null;
FIRST.chat_send = null; // só do contador: sem dado antes da data de corte

const DEFAULT_FILTERS: FeatureUsageFilters = { kinds: ['ACTION', 'AUTOMATIC'], tenantStatus: 'ACTIVE', includeInternal: false };

const r = (day: string, tenantId: string, featureKey: string, kind: FeatureUsageKind, uses = 1): FeatureUsageRow => ({
  day,
  tenantId,
  featureKey,
  kind,
  uses,
  activeDays: 1,
  lastDay: day,
});

function run(rows: FeatureUsageRow[], over: Partial<Omit<AggregateFeatureUsageInput, 'filters'>> & { filters?: Partial<FeatureUsageFilters> } = {}) {
  const { filters, ...rest } = over;
  return aggregateFeatureUsage({
    rows,
    firstDataDay: FIRST,
    tenants: TENANTS,
    catalog: FEATURE_USAGE_CATALOG,
    period: P30,
    now: NOW,
    ...rest,
    filters: { ...DEFAULT_FILTERS, ...filters },
  });
}

const keysOf = (out: ReturnType<typeof run>) => out.features.map((f) => f.key);
const feature = (out: ReturnType<typeof run>, key: string) => out.features.find((f) => f.key === key)!;

describe('recorte por tipo', () => {
  it('padrão ação + automático tira login e cliques e conta só os recursos que cruzam o filtro', () => {
    const out = run([r('2026-11-10', 't1', 'offer_generator', 'ACTION')]);
    expect(keysOf(out)).not.toContain('panel_login');
    expect(keysOf(out)).not.toContain('link_rotation_click');
    expect(out.neverUsed).not.toContain('panel_login');
    expect(out.totals.featuresUsed + out.totals.featuresNeverUsed).toBe(15);
    expect(out.totals.featuresUsed).toBe(1);
  });

  it('com tipo acesso só aparece a entrada no painel', () => {
    const out = run([r('2026-11-10', 't1', 'panel_login', 'ACCESS')], { filters: { kinds: ['ACCESS'] } });
    expect(keysOf(out)).toEqual(['panel_login']);
  });

  it('só ação não traz reescrita por IA nem envio', () => {
    const out = run([], { filters: { kinds: ['ACTION'] } });
    expect(keysOf(out)).not.toContain('ai_rewrite');
    expect(keysOf(out)).not.toContain('offer_dispatch');
    expect(keysOf(out)).toContain('offer_hunter');
  });

  it('no Caçador, só ação mantém as execuções manuais e tira as agendadas', () => {
    const rows = [
      r('2026-11-10', 't1', 'offer_hunter', 'ACTION', 2),
      r('2026-11-10', 't2', 'offer_hunter', 'AUTOMATIC', 5),
    ];
    const both = feature(run(rows), 'offer_hunter');
    expect(both.uses).toBe(7);
    expect(both.activeTenants).toBe(2);
    expect(both.byKind).toEqual([
      { kind: 'ACTION', uses: 2, activeTenants: 1 },
      { kind: 'AUTOMATIC', uses: 5, activeTenants: 1 },
    ]);
    const action = feature(run(rows, { filters: { kinds: ['ACTION'] } }), 'offer_hunter');
    expect(action.uses).toBe(2);
    expect(action.activeTenants).toBe(1);
    expect(action.byKind).toEqual([{ kind: 'ACTION', uses: 2, activeTenants: 1 }]);
    expect(action.kinds).toEqual(['ACTION', 'AUTOMATIC']);
  });

  it('combina produto e tipo', () => {
    const out = run([], { filters: { product: 'AFFILIATES', kinds: ['AUTOMATIC'] } });
    expect(keysOf(out).sort()).toEqual(['ai_rewrite', 'group_monitoring', 'offer_dispatch', 'offer_hunter']);
    expect(keysOf(run([], { filters: { product: 'SESSION' } })).sort()).toEqual(['telegram_session', 'whatsapp_session']);
  });
});

describe('primeiro dado, limite efetivo e tendência', () => {
  it('panel_login com primeiro dado há 40 dias: dados desde 40 dias, limite efetivo de 30', () => {
    const f = feature(run([], { filters: { kinds: ['ACCESS'] } }), 'panel_login');
    expect(f.firstDataDay).toBe('2026-10-08');
    expect(f.dataFrom).toBe('2026-10-18');
    expect(f.usesPrevious).toBeNull(); // retenção de 30 dias: anterior começa em 2026-09-19
    expect(f.activeTenantsPrevious).toBeNull();
  });

  it('recurso sem dado sai com os dois limites e a tendência nulos', () => {
    const f = feature(run([]), 'telegram_session');
    expect(f.firstDataDay).toBeNull();
    expect(f.dataFrom).toBeNull();
    expect(f.usesPrevious).toBeNull();
    expect(f.activeTenantsPrevious).toBeNull();
  });

  const ALL_BASE = { ...FIRST, telegram_session: '2026-01-01' };

  it('compara com o período anterior quando há base', () => {
    const out = run([r('2026-11-10', 't1', 'offer_generator', 'ACTION', 3), r('2026-10-01', 't2', 'offer_generator', 'ACTION', 2), r('2026-10-02', 't1', 'offer_generator', 'ACTION')], { firstDataDay: ALL_BASE });
    const f = feature(out, 'offer_generator');
    expect(f.uses).toBe(3);
    expect(f.usesPrevious).toBe(3);
    expect(f.activeTenantsPrevious).toBe(2);
    expect(out.totals.activeTenantsPrevious).toBe(2);
  });

  it('tendência nula quando o período anterior começa antes do primeiro dado', () => {
    const out = run([r('2026-11-10', 't1', 'offer_generator', 'ACTION')], { firstDataDay: { ...FIRST, offer_generator: '2026-10-01' } });
    expect(feature(out, 'offer_generator').usesPrevious).toBeNull();
  });

  it('total anterior nulo quando um recurso do recorte tem o primeiro dado dentro do período anterior', () => {
    const rows = [r('2026-10-01', 't2', 'offer_generator', 'ACTION')];
    expect(run(rows, { firstDataDay: ALL_BASE }).totals.activeTenantsPrevious).toBe(1);
    const out = run(rows, { firstDataDay: { ...ALL_BASE, offer_dispatch: '2026-10-05' } });
    expect(feature(out, 'offer_generator').activeTenantsPrevious).toBe(1);
    expect(out.totals.activeTenantsPrevious).toBeNull();
  });

  it('recurso que nunca teve dado não anula o total anterior; corte de retenção anula', () => {
    expect(run([]).totals.activeTenantsPrevious).toBe(0); // telegram_session sem nenhum dado é ignorado
    expect(run([], { firstDataDay: ALL_BASE, filters: { kinds: ['ACCESS'] } }).totals.activeTenantsPrevious).toBeNull();
  });

  it('total de contas ativas sem base quando nenhum recurso tem dado antes do período anterior', () => {
    const recent = Object.fromEntries(Object.keys(FIRST).map((k) => [k, '2026-11-01']));
    expect(run([], { firstDataDay: recent }).totals.activeTenantsPrevious).toBeNull();
  });
});

describe('famílias de plano', () => {
  it('conta só-Saver fica em NONE nos Afiliados e no plano dela no Saver', () => {
    const out = run([]);
    const aff = out.population.byPlan.filter((p) => p.family === 'AFFILIATES');
    const saver = out.population.byPlan.filter((p) => p.family === 'SAVER');
    expect(aff.find((p) => p.plan === 'NONE')!.tenants).toBe(1);
    expect(saver.find((p) => p.plan === 'SAVER_PRO')!.tenants).toBe(2);
    expect(saver.find((p) => p.plan === 'NONE')!.tenants).toBe(1);
  });

  it('em cada família a soma do por plano é a população, e o por plano do recurso repete o da família', () => {
    const out = run([r('2026-11-10', 't2', 'saver_extraction', 'ACTION'), r('2026-11-10', 't1', 'offer_generator', 'ACTION')]);
    expect(out.population.tenants).toBe(3);
    for (const family of ['AFFILIATES', 'SAVER'] as const) {
      const rows = out.population.byPlan.filter((p) => p.family === family);
      expect(rows.reduce((s, p) => s + p.tenants, 0)).toBe(out.population.tenants);
    }
    for (const f of out.features) {
      const pop = out.population.byPlan.filter((p) => p.family === f.planFamily).map(({ plan, tenants }) => ({ plan, tenants }));
      expect(f.byPlan.map(({ plan, tenants }) => ({ plan, tenants }))).toEqual(pop);
    }
    expect(feature(out, 'saver_extraction').byPlan.find((p) => p.plan === 'SAVER_PRO')).toEqual({
      plan: 'SAVER_PRO',
      tenants: 2,
      activeTenants: 1,
      uses: 1,
    });
  });

  it('plano do Saver devolve só recursos do Saver e só contas com esse plano', () => {
    const out = run([r('2026-11-10', 't2', 'offer_generator', 'ACTION'), r('2026-11-10', 't3', 'saver_export', 'ACTION')], {
      filters: { plan: 'SAVER_PRO' },
    });
    expect(keysOf(out).sort()).toEqual(['saver_export', 'saver_extraction']);
    expect(out.population.tenants).toBe(2);
    expect(out.population.byPlan).toEqual([{ family: 'SAVER', plan: 'SAVER_PRO', tenants: 2 }]);
    expect(out.totals.activeTenants).toBe(1);
  });

  it('plano de Afiliados não devolve recurso do Saver', () => {
    const out = run([], { filters: { plan: 'COPYSYNC_MAX' } });
    expect(out.features.every((f) => f.planFamily === 'AFFILIATES')).toBe(true);
    expect(out.population.tenants).toBe(1);
  });

  it('sem plano devolve as duas famílias, cada uma com as contas sem plano nela', () => {
    const out = run([], { filters: { plan: 'NONE' } });
    expect(out.population.byPlan).toEqual([
      { family: 'AFFILIATES', plan: 'NONE', tenants: 1 }, // t3
      { family: 'SAVER', plan: 'NONE', tenants: 1 }, // t1 (t2 tem Saver; tem Afiliados e não tem Saver: só t1 entre os ativos)
    ]);
    expect(out.population.tenants).toBe(2);
    expect(keysOf(out)).toContain('saver_extraction');
    expect(keysOf(out)).toContain('offer_generator');
  });

  it('alcance é contas que usaram ÷ contas da família, e zero sem contas', () => {
    const out = run([r('2026-11-10', 't1', 'offer_generator', 'ACTION')]);
    expect(feature(out, 'offer_generator').reach).toBe(0.3333);
    const empty = run([], { filters: { tenantId: 'nao-existe' } });
    expect(empty.population.tenants).toBe(0);
    expect(empty.features.every((f) => f.reach === 0)).toBe(true);
  });
});

describe('motivos de cobertura do período', () => {
  it('panel_login: 7 dias sem motivo, 90 dias com retenção', () => {
    const p7 = resolveUsagePeriod({ from: '2026-11-11', to: '2026-11-17', granularity: 'day', now: NOW, maxDays: 90 });
    const p90 = resolveUsagePeriod({ from: '2026-08-20', to: '2026-11-17', granularity: 'week', now: NOW, maxDays: 90 });
    const f7 = feature(run([], { period: p7, filters: { kinds: ['ACCESS'] } }), 'panel_login');
    expect(f7.coverageReasons).toEqual([]);
    expect(f7.coverage).toBe('FULL');
    const f90 = feature(run([], { period: p90, filters: { kinds: ['ACCESS'] } }), 'panel_login');
    expect(f90.coverageReasons).toEqual(['RETENTION']);
    expect(f90.coverage).toBe('PARTIAL');
  });

  it('motivos fixos na fonte viva', () => {
    const out = run([], { filters: { kinds: [] } });
    expect(feature(out, 'link_rotation').coverageReasons).toEqual(['EXISTING_ONLY']);
    expect(feature(out, 'offer_story').coverageReasons).toEqual(['AI_HEADLINE_ONLY']);
    expect(feature(out, 'affiliate_credentials').coverageReasons).toEqual(['MIXED_EVENTS']);
    expect(feature(out, 'ai_rewrite').coverageReasons).toEqual(['MIXED_TRIGGERS']);
    expect(feature(out, 'offer_dispatch').coverageReasons).toEqual(['MIXED_TRIGGERS']);
    expect(feature(out, 'extension_sync').coverageReasons).toEqual(['TOKEN_CHANGE_ONLY']);
    expect(feature(out, 'link_rotation_click').coverageReasons).toEqual(['EXISTING_ONLY']); // 30 dias < retenção de 90
    expect(feature(out, 'link_rotation_click').retentionDays).toBe(90);
    const full = feature(out, 'offer_generator');
    expect(full.coverage).toBe('FULL');
    expect(full.coverageReasons).toEqual([]);
    expect(full.retentionDays).toBeNull();
  });

  it('story deixa de ser parcial a partir da data de corte', () => {
    const catalog = FEATURE_USAGE_CATALOG.map((f) => (f.key === 'offer_story' ? { ...f, source: 'RECORDED' as const, recordedFrom: '2026-10-01' } : f));
    expect(feature(run([], { catalog }), 'offer_story').coverageReasons).toEqual([]);
    const late = FEATURE_USAGE_CATALOG.map((f) => (f.key === 'offer_story' ? { ...f, source: 'RECORDED' as const, recordedFrom: '2026-11-01' } : f));
    expect(feature(run([], { catalog: late }), 'offer_story').coverageReasons).toEqual(['AI_HEADLINE_ONLY']);
  });
});

describe('totais', () => {
  it('conta que usou 3 recursos conta uma vez e não há total de usos nem usuários', () => {
    const out = run([
      r('2026-11-10', 't1', 'offer_generator', 'ACTION', 4),
      r('2026-11-11', 't1', 'offer_dispatch', 'AUTOMATIC', 9),
      r('2026-11-12', 't1', 'group_monitoring', 'AUTOMATIC'),
    ]);
    expect(out.totals.activeTenants).toBe(1);
    expect(out.totals).not.toHaveProperty('uses');
    expect(JSON.stringify(out)).not.toMatch(/activeUsers|"users"/);
  });

  it('recurso mais usado é o de mais contas, depois mais usos, depois a chave; null sem uso', () => {
    const out = run([
      r('2026-11-10', 't1', 'offer_generator', 'ACTION'),
      r('2026-11-10', 't2', 'offer_generator', 'ACTION'),
      r('2026-11-10', 't1', 'offer_dispatch', 'AUTOMATIC', 50),
    ]);
    expect(out.totals.topFeature).toBe('offer_generator');
    const tie = run([r('2026-11-10', 't1', 'storefront', 'ACTION', 2), r('2026-11-10', 't1', 'link_rotation', 'ACTION', 2)]);
    expect(tie.totals.topFeature).toBe('link_rotation');
    const more = run([r('2026-11-10', 't1', 'storefront', 'ACTION', 3), r('2026-11-10', 't1', 'link_rotation', 'ACTION', 2)]);
    expect(more.totals.topFeature).toBe('storefront');
    expect(run([]).totals.topFeature).toBeNull();
  });

  it('conta interna sai por padrão e entra com includeInternal', () => {
    const rows = [r('2026-11-10', 't4', 'offer_generator', 'ACTION')];
    const out = run(rows);
    expect(out.totals.activeTenants).toBe(0);
    expect(out.population.internalExcluded).toBe(1);
    const withInternal = run(rows, { filters: { includeInternal: true } });
    expect(withInternal.totals.activeTenants).toBe(1);
    expect(withInternal.population.internalExcluded).toBe(0);
  });

  it('status filtra as contas e ALL inclui todas', () => {
    const rows = [r('2026-11-10', 't5', 'offer_generator', 'ACTION')];
    expect(run(rows).totals.activeTenants).toBe(0);
    expect(run(rows, { filters: { tenantStatus: 'SUSPENDED' } }).totals.activeTenants).toBe(1);
    expect(run(rows, { filters: { tenantStatus: 'ALL' } }).population.tenants).toBe(4);
  });

  it('ignora linha de conta fora do diretório', () => {
    const out = run([r('2026-11-10', 'fantasma', 'offer_generator', 'ACTION')]);
    expect(out.totals.activeTenants).toBe(0);
    expect(out.neverUsed).toContain('offer_generator');
  });

  it('recurso sem linha aparece em nunca usados', () => {
    const out = run([r('2026-11-10', 't1', 'offer_generator', 'ACTION')]);
    expect(out.neverUsed).toContain('storefront');
    expect(out.neverUsed).not.toContain('offer_generator');
  });
});

describe('séries', () => {
  it('bucket sem uso vem com zero e cada recurso tem a sua série', () => {
    const out = run([r('2026-11-10', 't1', 'offer_generator', 'ACTION', 2), r('2026-11-10', 't2', 'storefront', 'ACTION')]);
    expect(out.series).toHaveLength(30);
    expect(out.series.find((s) => s.bucket === '2026-11-10')!.activeTenants).toBe(2);
    expect(out.series.find((s) => s.bucket === '2026-11-09')!.activeTenants).toBe(0);
    expect(out.featureSeries.offer_generator!.find((s) => s.bucket === '2026-11-10')).toEqual({ bucket: '2026-11-10', uses: 2, activeTenants: 1 });
  });

  it('linhas por dia e as mesmas linhas agrupadas por semana dão as mesmas contagens', () => {
    const p = resolveUsagePeriod({ from: '2026-10-19', to: '2026-11-15', granularity: 'week', now: NOW, maxDays: 90 });
    const daily = [
      r('2026-10-19', 't1', 'offer_generator', 'ACTION', 2),
      r('2026-10-21', 't1', 'offer_generator', 'ACTION', 1),
      r('2026-10-28', 't2', 'offer_generator', 'ACTION', 4),
      r('2026-11-14', 't1', 'offer_generator', 'ACTION', 1),
      r('2026-11-15', 't2', 'offer_generator', 'ACTION', 3),
    ];
    const grouped = new Map<string, FeatureUsageRow>();
    for (const row of daily) {
      const day = bucketOf(row.day, 'week');
      const key = `${day}|${row.tenantId}`;
      const g = grouped.get(key) ?? { ...row, day, uses: 0, activeDays: 0, lastDay: row.day };
      g.uses += row.uses;
      g.activeDays += 1;
      if (row.day > g.lastDay) g.lastDay = row.day;
      grouped.set(key, g);
    }
    const a = run(daily, { period: p });
    const b = run([...grouped.values()], { period: p });
    expect(feature(b, 'offer_generator')).toEqual(feature(a, 'offer_generator'));
    expect(b.series).toEqual(a.series);
    expect(b.totals).toEqual(a.totals);
    expect(rankFeatureTenants([...grouped.values()], 'offer_generator')).toEqual(rankFeatureTenants(daily, 'offer_generator'));
    expect(feature(a, 'offer_generator').lastUsedDay).toBe('2026-11-15');
  });
});

describe('rankFeatureTenants', () => {
  it('ordena por usos desc e conta asc, com dias ativos e último uso', () => {
    const rows = [
      r('2026-11-10', 'b', 'offer_hunter', 'ACTION', 2),
      r('2026-11-10', 'b', 'offer_hunter', 'AUTOMATIC', 1), // mesmo dia, outro tipo: 1 dia ativo
      r('2026-11-12', 'b', 'offer_hunter', 'ACTION', 1),
      r('2026-11-11', 'a', 'offer_hunter', 'ACTION', 4),
      r('2026-11-11', 'c', 'offer_hunter', 'ACTION', 1),
      r('2026-11-11', 'c', 'storefront', 'ACTION', 9),
    ];
    expect(rankFeatureTenants(rows, 'offer_hunter')).toEqual([
      { tenantId: 'a', uses: 4, activeDays: 1, lastUsedDay: '2026-11-11' },
      { tenantId: 'b', uses: 4, activeDays: 2, lastUsedDay: '2026-11-12' },
      { tenantId: 'c', uses: 1, activeDays: 1, lastUsedDay: '2026-11-11' },
    ]);
  });
});
