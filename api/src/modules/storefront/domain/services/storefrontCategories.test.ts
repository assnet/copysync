import { describe, it, expect } from 'vitest';
import { STOREFRONT_CATEGORIES, STOREFRONT_CATEGORY_KEYS, isStorefrontCategory } from './storefrontCategories';

describe('storefrontCategories', () => {
  it('catálogo fixo de 17 categorias com chave e rótulo únicos', () => {
    expect(STOREFRONT_CATEGORIES).toHaveLength(17);
    expect(new Set(STOREFRONT_CATEGORY_KEYS).size).toBe(17);
    expect(new Set(STOREFRONT_CATEGORIES.map((c) => c.label)).size).toBe(17);
  });

  it('chaves estáveis em snake_case inglês', () => {
    for (const key of STOREFRONT_CATEGORY_KEYS) expect(key).toMatch(/^[a-z]+(?:_[a-z]+)*$/);
    expect(STOREFRONT_CATEGORIES[0]).toEqual({ key: 'electronics', label: 'Eletrônicos' });
    expect(STOREFRONT_CATEGORIES.at(-1)).toEqual({ key: 'discount_coupons', label: 'Cupons de Desconto' });
  });

  it('reconhece só chaves do catálogo', () => {
    expect(isStorefrontCategory('pet_shop')).toBe(true);
    expect(isStorefrontCategory('Pet Shop')).toBe(false);
    expect(isStorefrontCategory('')).toBe(false);
  });
});
