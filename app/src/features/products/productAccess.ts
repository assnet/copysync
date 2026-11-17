/**
 * Acesso por produto no painel (docs/acesso-por-produto). Funções puras, sem React.
 * Espelha `api/src/modules/tenants/domain/services/resolveProductAccess.ts`: o painel só lê
 * `products` de `GET /tenants`; quem decide é a API (403 `PRODUCT_UNAVAILABLE`).
 */
export const PRODUCTS = ['AFFILIATES', 'CHAT', 'SAVER'] as const;
export type ProductKey = (typeof PRODUCTS)[number];

/** Tenant carregado sem o campo `products` (API antiga): mesmo acesso de hoje. */
export const LEGACY_PRODUCTS: readonly ProductKey[] = ['AFFILIATES', 'CHAT'];

/** Tela de assinatura: destino quando nenhum produto com acesso tem tela própria. */
export const SUBSCRIPTION_PATH = '/settings/subscription';

/** Vitrine de planos de Afiliados (rota antiga `/plans` redireciona). */
export const AFFILIATE_PLANS_PATH = '/affiliates/plans';

/** Início e vitrine do Saver (rotas em `routes/AppRoutes.tsx`). */
export const SAVER_HOME_PATH = '/saver';
export const SAVER_PLANS_PATH = '/saver/plans';

/**
 * Tela inicial de cada produto. Só entra produto cuja rota já existe: registrar uma home sem
 * rota faria o fallback `*` cair em laço.
 */
export const PRODUCT_HOME: Readonly<Partial<Record<ProductKey, string>>> = {
  AFFILIATES: '/dashboard',
  SAVER: SAVER_HOME_PATH,
};

/** Vitrine de planos por produto. `CHAT` não tem plano próprio: acompanha Afiliados. */
export const PRODUCT_PLANS_PATH = {
  AFFILIATES: AFFILIATE_PLANS_PATH,
  CHAT: AFFILIATE_PLANS_PATH,
  SAVER: SAVER_PLANS_PATH,
} as const satisfies Partial<Record<ProductKey, string>>;

export function isProductKey(value: unknown): value is ProductKey {
  return typeof value === 'string' && (PRODUCTS as readonly string[]).includes(value);
}

export function hasProduct(products: readonly ProductKey[], product: ProductKey): boolean {
  return products.includes(product);
}

/** Vitrine do produto; sem vitrine registrada, a assinatura. */
export function plansPathFor(product: ProductKey): string {
  return (PRODUCT_PLANS_PATH as Partial<Record<ProductKey, string>>)[product] ?? SUBSCRIPTION_PATH;
}

/**
 * Produtos de um tenant já carregado. Sem o campo (API antiga) = legado; chaves que o
 * painel não conhece são ignoradas.
 */
export function productsOfTenant(tenant: { products?: readonly string[] } | null | undefined): ProductKey[] {
  if (!tenant || !Array.isArray(tenant.products)) return [...LEGACY_PRODUCTS];
  return tenant.products.filter(isProductKey);
}

/** Com Afiliados = `/dashboard`; senão o 1º produto com tela; sem nenhum = assinatura. */
export function resolveHomePath(products: readonly ProductKey[]): string {
  if (hasProduct(products, 'AFFILIATES')) return PRODUCT_HOME.AFFILIATES ?? SUBSCRIPTION_PATH;
  for (const product of products) {
    const home = PRODUCT_HOME[product];
    if (home) return home;
  }
  return SUBSCRIPTION_PATH;
}
