/**
 * Catálogo fixo de categorias da Página de Ofertas (context.md decisão 9).
 *
 * A chave é o que vai ao banco (`Storefront.categories`, `StorefrontOffer.category`): estável,
 * snake_case em inglês, nunca renomear. O rótulo pt-BR é o texto exibido na página pública e
 * no painel. A página escolhe quais destas mostrar.
 */
export const STOREFRONT_CATEGORIES = [
  { key: 'electronics', label: 'Eletrônicos' },
  { key: 'phones_tablets', label: 'Celulares & Tablets' },
  { key: 'computers', label: 'Informática' },
  { key: 'home_decor', label: 'Casa & Decoração' },
  { key: 'womens_fashion', label: 'Moda Feminina' },
  { key: 'mens_fashion', label: 'Moda Masculina' },
  { key: 'beauty_health', label: 'Beleza & Saúde' },
  { key: 'sports_leisure', label: 'Esporte & Lazer' },
  { key: 'food_drinks', label: 'Alimentos & Bebidas' },
  { key: 'toys_games', label: 'Brinquedos & Games' },
  { key: 'baby_kids', label: 'Bebê & Infantil' },
  { key: 'pet_shop', label: 'Pet Shop' },
  { key: 'automotive', label: 'Automotivo' },
  { key: 'tools', label: 'Ferramentas' },
  { key: 'books_stationery', label: 'Livros & Papelaria' },
  { key: 'flash_deals', label: 'Ofertas Relâmpago' },
  { key: 'discount_coupons', label: 'Cupons de Desconto' },
] as const;

export type StorefrontCategory = (typeof STOREFRONT_CATEGORIES)[number];
export type StorefrontCategoryKey = StorefrontCategory['key'];

export const STOREFRONT_CATEGORY_KEYS: readonly StorefrontCategoryKey[] = STOREFRONT_CATEGORIES.map((c) => c.key);

const KEY_SET: ReadonlySet<string> = new Set(STOREFRONT_CATEGORY_KEYS);

export function isStorefrontCategory(key: string): key is StorefrontCategoryKey {
  return KEY_SET.has(key);
}
