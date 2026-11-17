/**
 * Acesso por produto (ver `docs/acesso-por-produto.md`). Função pura, sem banco.
 *
 * - Produto legado (`AFFILIATES`, `CHAT`) sem linha em `tenant_products` = ativo: nenhum tenant de hoje perde acesso
 *   e não existe backfill.
 * - Produto novo (`SAVER`) sem linha = inativo.
 * - Linha presente: vale `status === 'ACTIVE'`.
 * - `CHAT` não tem plano próprio: acompanha a linha de `AFFILIATES` (`ACCESS_FOLLOWS`). Nenhuma linha `CHAT` é gravada.
 */
export const PRODUCTS = ['AFFILIATES', 'CHAT', 'SAVER'] as const;
export type ProductKey = (typeof PRODUCTS)[number];

export const LEGACY_PRODUCTS: readonly ProductKey[] = ['AFFILIATES', 'CHAT'];

/** Produto cujo acesso é decidido pela linha de outro produto. */
export const ACCESS_FOLLOWS: Partial<Record<ProductKey, ProductKey>> = { CHAT: 'AFFILIATES' };

export type TenantProductStatus = 'ACTIVE' | 'INACTIVE';

export interface ProductAccessRow {
  status: TenantProductStatus;
}

export function isProductKey(value: unknown): value is ProductKey {
  return typeof value === 'string' && (PRODUCTS as readonly string[]).includes(value);
}

export function isLegacyProduct(product: ProductKey): boolean {
  return LEGACY_PRODUCTS.includes(product);
}

/** Produto cuja linha decide o acesso de `product` (o próprio, salvo `ACCESS_FOLLOWS`). */
export function accessSourceOf(product: ProductKey): ProductKey {
  return ACCESS_FOLLOWS[product] ?? product;
}

/**
 * `row` é a linha do produto **fonte** (`accessSourceOf(product)`); quem chama busca essa linha.
 * Sem linha: legado = true, novo = false. Com linha: `ACTIVE`.
 */
export function resolveProductAccess(product: ProductKey, row: ProductAccessRow | null): boolean {
  if (!row) return isLegacyProduct(accessSourceOf(product));
  return row.status === 'ACTIVE';
}

/** Lista de produtos com acesso, a partir das linhas do tenant (chave = produto). */
export function listProductAccess(rows: ReadonlyMap<ProductKey, ProductAccessRow>): ProductKey[] {
  return PRODUCTS.filter((product) => resolveProductAccess(product, rows.get(accessSourceOf(product)) ?? null));
}
