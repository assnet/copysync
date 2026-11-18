import type { FeatureUsageDefinition, FeatureUsageKind, FeatureUsagePlanFamily, FeatureUsageProduct } from './featureUsageCatalog';

/**
 * Telas do menu medidas por visita (P3, USAGE-22/23). Lista fechada que espelha as chaves de `buildNavigation`
 * (`app/src/features/navigation/model.ts`) visíveis à conta: telas do super admin e o Chat (só super admin) ficam de
 * fora. Chave = `view:<chave do item do menu>`; rótulo é do painel (strings de navegação).
 *
 * Fora de `FEATURE_USAGE_CATALOG` de propósito: as telas nunca entram nas linhas do resumo nem nas `keys` do rollup.
 * São só do contador (`RECORDED`), sem data de corte: não existe fonte viva anterior, a contagem vale desde a primeira
 * escrita e o primeiro dado é o `MIN(day)` no agregado.
 */
export const SCREEN_VIEW_PREFIX = 'view:';

export interface ScreenViewDefinition {
  key: `view:${string}`;
  product: FeatureUsageProduct;
  planFamily: FeatureUsagePlanFamily;
  kinds: readonly FeatureUsageKind[];
  source: 'RECORDED';
}

const screen = (menuKey: string, product: FeatureUsageProduct, planFamily: FeatureUsagePlanFamily = 'AFFILIATES'): ScreenViewDefinition => ({
  key: `view:${menuKey}`,
  product,
  planFamily,
  kinds: ['ACCESS'],
  source: 'RECORDED',
});

export const SCREEN_VIEW_CATALOG: readonly ScreenViewDefinition[] = [
  screen('dashboard', 'ACCESS'),
  screen('offers', 'AFFILIATES'),
  screen('monitoring', 'AFFILIATES'),
  screen('broadcast-groups', 'AFFILIATES'),
  screen('link-rotation', 'AFFILIATES'),
  screen('storefront', 'AFFILIATES'),
  screen('offer-story', 'AFFILIATES'),
  screen('offer-hunter', 'AFFILIATES'),
  screen('affiliate-credentials', 'AFFILIATES'),
  screen('affiliate-tutorials', 'AFFILIATES'),
  screen('affiliate-plans', 'AFFILIATES'),
  screen('saver-groups', 'SAVER', 'SAVER'),
  screen('saver-settings', 'SAVER', 'SAVER'),
  screen('saver-plans', 'SAVER', 'SAVER'),
  screen('settings', 'ACCESS'),
];

export const SCREEN_VIEW_KEYS: readonly string[] = SCREEN_VIEW_CATALOG.map((s) => s.key);

export function findScreenView(key: string): ScreenViewDefinition | undefined {
  return SCREEN_VIEW_CATALOG.find((s) => s.key === key);
}

/** Forma de recurso para o contador: `FIRST_WRITE` (sem corte; `sourceOn` = `RECORDED` em qualquer dia). */
export function screenAsFeature(screen: ScreenViewDefinition): FeatureUsageDefinition {
  return {
    key: screen.key as FeatureUsageDefinition['key'],
    product: screen.product,
    planFamily: screen.planFamily,
    kinds: screen.kinds,
    source: 'RECORDED',
    recordedFrom: 'FIRST_WRITE',
    possibleCoverageReasons: [],
    phase: 3,
  };
}
