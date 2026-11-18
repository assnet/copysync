import { describe, expect, it } from 'vitest';
import {
  DEFAULT_USAGE_FILTERS, adoptionCell, clearUsageFilters, activeFiltersCount, parseUsageFilters, recurringCell, retentionCell,
  screenFeatureUse, screenLabel, screensCollectionNotice, toUsageQuery, toUsageSummaryQuery, visibleScreens,
} from './rules';
import { featureUsageStrings as S } from './strings';
import { screensFixture, summaryFixture } from './testFixtures';
import type { UsageFeatureItem } from './types';

const NOW = Date.UTC(2026, 10, 18, 1, 0, 0);
const feature = (key: UsageFeatureItem['key']) => summaryFixture().features.find((f) => f.key === key)!;

describe('adoção, recorrência e retenção (P3)', () => {
  it('adoção mostra o percentual e o denominador de contas com direito', () => {
    const cell = adoptionCell(feature('offer_generator'));
    expect(cell).toEqual({ value: '67%', hint: S.retention.adoptionOf('8', '12'), missing: false });
  });

  it('adoção null (sem conta com direito) vira "—" com explicação', () => {
    const cell = adoptionCell(feature('telegram_session'));
    expect(cell).toEqual({ value: S.measures.noValue, hint: S.retention.noEligible, missing: true });
  });

  it('recorrência = recorrentes ÷ contas que usaram, com o N no texto', () => {
    const f = feature('offer_generator');
    expect(recurringCell(f, 3)).toEqual({ value: '63%', hint: S.retention.recurringOf('5', '8', 3), missing: false });
    expect(recurringCell({ recurringTenants: 0, activeTenants: 0 }, 3).missing).toBe(true);
    expect(recurringCell({ recurringTenants: null, activeTenants: 4 }, 3).missing).toBe(true);
  });

  it('retenção = voltaram ÷ contas do período anterior; sem base vira "—"', () => {
    expect(retentionCell(feature('offer_generator'))).toEqual({ value: '67%', hint: S.retention.retainedOf('4', '6'), missing: false });
    expect(retentionCell(feature('offer_hunter'))).toEqual({ value: S.measures.noValue, hint: S.retention.noBase, missing: true });
    expect(retentionCell({ retainedTenants: 0, activeTenantsPrevious: 0 }).missing).toBe(true);
  });
});

describe('N da recorrência nos filtros', () => {
  it('só o resumo leva recurringDays; a query comum não', () => {
    const filters = { ...DEFAULT_USAGE_FILTERS, recurringDays: 5 as const };
    expect(toUsageSummaryQuery(filters, NOW)).toEqual({ ...toUsageQuery(filters, NOW), recurringDays: '5' });
    expect('recurringDays' in toUsageQuery(filters, NOW)).toBe(false);
  });

  it('persistido com os filtros; valor fora de 2/3/5 volta a 3; não conta como filtro e sobrevive ao limpar', () => {
    expect(parseUsageFilters({ ...DEFAULT_USAGE_FILTERS, recurringDays: 2 }, NOW).recurringDays).toBe(2);
    expect(parseUsageFilters({ ...DEFAULT_USAGE_FILTERS, recurringDays: 4 }, NOW).recurringDays).toBe(3);
    expect(parseUsageFilters({ ...DEFAULT_USAGE_FILTERS, recurringDays: '5' }, NOW).recurringDays).toBe(3);
    const changed = { ...DEFAULT_USAGE_FILTERS, recurringDays: 5 as const };
    expect(activeFiltersCount(changed)).toBe(0);
    expect(clearUsageFilters(changed).recurringDays).toBe(5);
  });
});

describe('telas (P3)', () => {
  it('ordena por contas que abriram e respeita produto e plano', () => {
    const data = screensFixture();
    expect(visibleScreens(data.screens, DEFAULT_USAGE_FILTERS).map((s) => s.key))
      .toEqual(['view:offers', 'view:dashboard', 'view:saver-groups', 'view:offer-story']);
    expect(visibleScreens(data.screens, { product: 'SAVER', plan: 'all' }).map((s) => s.key)).toEqual(['view:saver-groups']);
    expect(visibleScreens(data.screens, { product: 'all', plan: 'SAVER_PRO' }).map((s) => s.key)).toEqual(['view:saver-groups']);
  });

  it('rótulo igual ao do menu; chave desconhecida aparece crua', () => {
    expect(screenLabel('view:offers')).toBe('Gerador de ofertas');
    expect(screenLabel('view:nova')).toBe('view:nova');
  });

  it('cruzamento abriu × usou só para tela com recurso único no recorte', () => {
    const features = summaryFixture().features;
    expect(screenFeatureUse('view:offers', features)).toEqual({ feature: 'offer_generator', activeTenants: 8 });
    expect(screenFeatureUse('view:dashboard', features)).toBeNull();
    expect(screenFeatureUse('view:monitoring', features)).toBeNull();
    expect(screenFeatureUse('view:offers', null)).toBeNull();
  });

  it('aviso da coleta: sem dado, período antes do início e "desde"', () => {
    expect(screensCollectionNotice({ firstDataDay: null, range: { from: '2026-10-19' } })).toBe(S.screens.collectionNone);
    expect(screensCollectionNotice({ firstDataDay: '2026-11-19', range: { from: '2026-10-19' } })).toBe(S.screens.collectionPartial('19/11/2026'));
    expect(screensCollectionNotice({ firstDataDay: '2026-10-01', range: { from: '2026-10-19' } })).toBe(S.screens.collectionSince('01/10/2026'));
  });
});
