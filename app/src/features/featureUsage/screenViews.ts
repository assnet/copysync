/**
 * Telas medidas por visita (P3). Espelha `SCREEN_VIEW_CATALOG` da API e `screenKeys` de
 * `contracts/feature-usage/catalog.json`: chave = `view:<chave do item do menu>` (`buildNavigation`). Telas do super
 * admin e o Chat (só super admin) ficam de fora. Módulo leve de propósito: é carregado pelo layout de toda conta.
 */
export const SCREEN_VIEW_KEYS = [
  'view:dashboard',
  'view:offers',
  'view:monitoring',
  'view:broadcast-groups',
  'view:link-rotation',
  'view:storefront',
  'view:offer-story',
  'view:offer-hunter',
  'view:affiliate-credentials',
  'view:affiliate-tutorials',
  'view:affiliate-plans',
  'view:saver-groups',
  'view:saver-settings',
  'view:saver-plans',
  'view:settings',
] as const;

export type ScreenViewKey = (typeof SCREEN_VIEW_KEYS)[number];

/** Chave da visita para o item do menu, ou `null` quando a tela não é medida. */
export function screenViewKeyOf(menuKey: string | null | undefined): ScreenViewKey | null {
  if (!menuKey) return null;
  const key = `view:${menuKey}`;
  return (SCREEN_VIEW_KEYS as readonly string[]).includes(key) ? (key as ScreenViewKey) : null;
}

/** Dia `YYYY-MM-DD` em `America/Sao_Paulo` (o mesmo dia que a API usa para a marca). */
export function screenViewDay(nowMs: number): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date(nowMs));
}
