import { describe, expect, it } from 'vitest';
import {
  catalogFixture as catalog,
  detailDailyFixture,
  detailFixture,
  screensFixture,
  summaryDailyFixture,
  summaryFixture,
  summaryFixtureRaw as summaryRaw,
} from './testFixtures';
import { sourceState } from './rules';
import { SCREEN_VIEW_KEYS } from './screenViews';
import tenantsRaw from '../../../../contracts/feature-usage/feature-tenants.response.json?raw';
import { featureUsageStrings as S } from './strings';
import type {
  UsageFeatureDetail, UsageFeatureItem, UsagePopulation, UsageRange, UsageScreenItem, UsageScreensResponse, UsageSummary,
  UsageTenantItem, UsageTenantsPage, UsageTotals,
} from './types';

/** Lista de contas de exemplo (`?raw`, como as outras fixtures em `testFixtures.ts`); cópia nova a cada chamada. */
const tenantsFixture = (): UsageTenantsPage => JSON.parse(tenantsRaw) as UsageTenantsPage;

/* Validador de forma: o mapa de cada tipo é checado pelo `tsc` (chave a mais ou a menos não compila) e o teste
 * compara as fixtures com ele (campo a mais ou a menos na fixture falha). */
type Leaf = 'string' | 'number' | 'boolean' | 'null';
type Shape = Leaf[] | { object: Record<string, Shape> } | { array: Shape };
type ObjectShape<T> = { [K in keyof Required<T>]: Shape };

const obj = <T,>(fields: ObjectShape<T>): Shape => ({ object: fields as Record<string, Shape> });
const arr = (item: Shape): Shape => ({ array: item });
const str: Leaf[] = ['string'];
const num: Leaf[] = ['number'];
const strOrNull: Leaf[] = ['string', 'null'];
const numOrNull: Leaf[] = ['number', 'null'];

const rangeShape = obj<UsageRange>({
  from: str, to: str, timeZone: str, previousFrom: str, previousTo: str, granularity: str, maxDays: num,
});
const populationShape = obj<UsagePopulation>({
  tenants: num,
  internalExcluded: num,
  byPlan: arr({ object: { family: str, plan: str, tenants: num } }),
});
const totalsShape = obj<UsageTotals>({
  activeTenants: num, activeTenantsPrevious: numOrNull, featuresUsed: num, featuresNeverUsed: num, topFeature: strOrNull,
});
const featureShape = obj<UsageFeatureItem>({
  key: str,
  product: str,
  planFamily: str,
  kinds: arr(str),
  coverage: str,
  coverageReasons: arr(str),
  retentionDays: numOrNull,
  firstDataDay: strOrNull,
  dataFrom: strOrNull,
  uses: num,
  usesPrevious: numOrNull,
  activeTenants: num,
  activeTenantsPrevious: numOrNull,
  reach: num,
  lastUsedDay: strOrNull,
  byKind: arr({ object: { kind: str, uses: num, activeTenants: num } }),
  byPlan: arr({ object: { plan: str, tenants: num, activeTenants: num, uses: num } }),
  eligibleTenants: numOrNull,
  adoption: numOrNull,
  recurringTenants: numOrNull,
  retainedTenants: numOrNull,
});
const summaryShape = obj<UsageSummary>({
  range: rangeShape,
  source: str,
  freshAt: str,
  population: populationShape,
  totals: totalsShape,
  features: arr(featureShape),
  series: arr({ object: { bucket: str, activeTenants: num } }),
});
/** `inScope` (false = tipo/plano excluem o recurso) entra no contrato do detalhe; a interseção vale com ou sem o campo em `types.ts`. */
const detailShape = obj<UsageFeatureDetail & { inScope: boolean }>({
  range: rangeShape,
  source: str,
  freshAt: str,
  population: populationShape,
  inScope: ['boolean'],
  feature: featureShape,
  series: arr({ object: { bucket: str, uses: num, activeTenants: num } }),
});
const tenantItemShape = obj<UsageTenantItem>({
  tenantId: str, tenantName: str, plan: str, status: str, internal: ['boolean'], uses: num, activeDays: num, lastUsedDay: strOrNull,
});
const tenantsPageShape = obj<UsageTenantsPage>({ items: arr(tenantItemShape), nextCursor: strOrNull });
const screenItemShape = obj<UsageScreenItem>({ key: str, product: str, planFamily: str, tenants: num, tenantDays: num });
const screensShape = obj<UsageScreensResponse>({
  range: rangeShape,
  firstDataDay: strOrNull,
  population: { object: { tenants: num, byFamily: arr({ object: { family: str, tenants: num } }) } },
  screens: arr(screenItemShape),
});

function leafOf(value: unknown): Leaf | 'other' {
  if (value === null) return 'null';
  const t = typeof value;
  return t === 'string' || t === 'number' || t === 'boolean' ? t : 'other';
}

/** Lista de divergências (`caminho: problema`); vazia = a fixture bate com o tipo. */
function shapeErrors(value: unknown, shape: Shape, path = '$'): string[] {
  if (Array.isArray(shape)) {
    return shape.includes(leafOf(value) as Leaf) ? [] : [`${path}: esperado ${shape.join('|')}, veio ${JSON.stringify(value)}`];
  }
  if ('array' in shape) {
    if (!Array.isArray(value)) return [`${path}: esperado lista`];
    return value.flatMap((item, i) => shapeErrors(item, shape.array, `${path}[${i}]`));
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [`${path}: esperado objeto`];
  const record = value as Record<string, unknown>;
  const expected = Object.keys(shape.object);
  const errors = Object.keys(record).filter((k) => !expected.includes(k)).map((k) => `${path}.${k}: campo a mais`);
  for (const key of expected) {
    if (!(key in record)) errors.push(`${path}.${key}: campo ausente`);
    else errors.push(...shapeErrors(record[key], shape.object[key], `${path}.${key}`));
  }
  return errors;
}


describe('contrato do uso dos recursos (fixtures compartilhadas)', () => {
  it('o resumo de exemplo tem exatamente a forma de UsageSummary', () => {
    expect(shapeErrors(summaryFixture(), summaryShape)).toEqual([]);
  });

  it('o detalhe de exemplo tem exatamente a forma de UsageFeatureDetail', () => {
    expect(shapeErrors(detailFixture(), detailShape)).toEqual([]);
  });

  it('os exemplos do agregado (daily) têm a mesma forma, source daily, teto 400 e freshAt válido', () => {
    const summary = summaryDailyFixture();
    const detail = detailDailyFixture();
    expect(shapeErrors(summary, summaryShape)).toEqual([]);
    expect(shapeErrors(detail, detailShape)).toEqual([]);
    for (const d of [summary, detail]) {
      expect(d.source).toBe('daily');
      expect(d.range.maxDays).toBe(400);
      const fresh = Date.parse(d.freshAt);
      expect(Number.isNaN(fresh)).toBe(false);
      // O painel lê o frescor de freshAt: logo depois do tick é fresco; horas depois, velho
      expect(sourceState(d, fresh + 60_000)).toBe('fresh');
      expect(sourceState(d, fresh + 6 * 3_600_000)).toBe('stale');
    }
  });

  it('a lista de contas de exemplo tem exatamente a forma de UsageTenantsPage', () => {
    const page = tenantsFixture();
    expect(page.items.length).toBeGreaterThan(0);
    expect(shapeErrors(page, tenantsPageShape)).toEqual([]);
  });

  it('as telas de exemplo têm exatamente a forma de UsageScreensResponse, sem conta', () => {
    const data = screensFixture();
    expect(data.screens.length).toBeGreaterThan(0);
    expect(shapeErrors(data, screensShape)).toEqual([]);
    expect(JSON.stringify(data)).not.toMatch(/tenantId|tenantName/);
    for (const sc of data.screens) expect(catalog.screenKeys, sc.key).toContain(sc.key);
  });

  it.each([
    ['live', summaryFixture, detailFixture],
    ['daily', summaryDailyFixture, detailDailyFixture],
  ] as const)('P3 (%s): o resumo traz adoção, recorrência e retenção (adoção/retenção podem ser null); o detalhe os traz null', (_s, summaryOf, detailOf) => {
    const features = summaryOf().features;
    expect(features.some((f) => f.adoption !== null && f.eligibleTenants !== null && f.recurringTenants !== null)).toBe(true);
    expect(features.some((f) => f.adoption === null)).toBe(true);
    expect(features.some((f) => f.retainedTenants === null)).toBe(true);
    const { feature } = detailOf();
    expect([feature.eligibleTenants, feature.adoption, feature.recurringTenants, feature.retainedTenants]).toEqual([null, null, null, null]);
  });

  it('cada tela medida tem rótulo em strings.ts e a lista do painel é a do catálogo', () => {
    const labels = S.screens.labels as Record<string, string | undefined>;
    for (const key of catalog.screenKeys) expect(labels[key], key).toBeTruthy();
    expect([...SCREEN_VIEW_KEYS].sort()).toEqual([...catalog.screenKeys].sort());
  });

  it('o validador acusa campo a mais e campo a menos', () => {
    const base = summaryFixture();
    const extra = { ...base, totals: { ...base.totals, uses: 10 } };
    expect(shapeErrors(extra, summaryShape)).toContain('$.totals.uses: campo a mais');
    const { freshAt: _omit, ...missing } = base;
    void _omit;
    expect(shapeErrors(missing, summaryShape)).toContain('$.freshAt: campo ausente');
  });

  it('cada chave do catálogo tem rótulo e descrição em strings.ts', () => {
    const features = S.features as Record<string, { label: string; description: string } | undefined>;
    for (const key of catalog.featureKeys) {
      expect(features[key]?.label, key).toBeTruthy();
      expect(features[key]?.description, key).toBeTruthy();
    }
  });

  it('cada código de cobertura parcial tem um texto próprio', () => {
    const reasons = S.coverageReasons as Record<string, string | undefined>;
    for (const code of catalog.coverageReasonCodes) expect(reasons[code], code).toBeTruthy();
    const texts = catalog.coverageReasonCodes.map((c) => reasons[c]);
    expect(new Set(texts).size).toBe(texts.length);
  });

  it('o resumo não traz nome de conta nem soma de usos', () => {
    expect(summaryRaw).not.toContain('tenantName');
    expect('uses' in summaryFixture().totals).toBe(false);
  });
});
