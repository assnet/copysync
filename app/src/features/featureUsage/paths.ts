/** Rotas da tela de uso dos recursos (abas por sub-rota; uma `<Route>` explícita por caminho). */
export const USAGE_PATH = '/admin/usage';
/** Aba Por plano. */
export const USAGE_PLANS_PATH = '/admin/usage/plans';
/** Prefixo do detalhe de um recurso (`/admin/usage/features/:key`). */
export const USAGE_FEATURES_PREFIX = '/admin/usage/features';
/** Padrão da rota do detalhe para o `AppRoutes`. */
export const USAGE_FEATURE_ROUTE = `${USAGE_FEATURES_PREFIX}/:key`;

export function usageFeaturePath(key: string): string {
  return `${USAGE_FEATURES_PREFIX}/${encodeURIComponent(key)}`;
}

export type UsageTabId = 'overview' | 'plans';

/** Abas pela URL. No detalhe a aba marcada é a Visão geral. */
export const USAGE_TABS: { id: UsageTabId; path: string }[] = [
  { id: 'overview', path: USAGE_PATH },
  { id: 'plans', path: USAGE_PLANS_PATH },
];

export function activeUsageTab(pathname: string): UsageTabId {
  if (pathname === USAGE_PLANS_PATH || pathname.startsWith(`${USAGE_PLANS_PATH}/`)) return 'plans';
  return 'overview';
}

/** Chave do recurso aberto no detalhe, ou `null` fora dele. */
export function featureKeyFromPath(pathname: string): string | null {
  if (!pathname.startsWith(`${USAGE_FEATURES_PREFIX}/`)) return null;
  const raw = pathname.slice(USAGE_FEATURES_PREFIX.length + 1).split('/')[0];
  if (!raw) return null;
  try {
    return decodeURIComponent(raw);
  } catch {
    return null;
  }
}
