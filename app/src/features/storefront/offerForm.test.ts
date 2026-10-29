import { describe, expect, it } from 'vitest';
import {
  categoryLabel, centsToReaisInput, editFormFromOffer, editOfferPatch, pageCategoryOptions, parseReaisToCents, validateEditOffer,
} from './offerForm';
import type { StorefrontOffer } from './types';

const offer: StorefrontOffer = {
  id: 'o1', status: 'DRAFT', position: 0, provider: 'SHOPEE', sourceUrl: 's', affiliateUrl: 'a', attributionVerified: true,
  title: 'Fone', priceCents: 4990, originalPriceCents: null, imageUrl: null, category: null,
  publishedAt: null, createdAt: '', updatedAt: '',
};

describe('parseReaisToCents', () => {
  it('converte reais escritos de vários jeitos em centavos', () => {
    expect(parseReaisToCents('R$ 1.234,56')).toBe(123456);
    expect(parseReaisToCents('49,9')).toBe(4990);
    expect(parseReaisToCents('12.50')).toBe(1250);
    expect(parseReaisToCents('1.234')).toBe(123400);
    expect(parseReaisToCents('10')).toBe(1000);
    expect(parseReaisToCents('0,07')).toBe(7);
  });
  it('vazio vira sem preço e texto inválido é recusado', () => {
    expect(parseReaisToCents('  ')).toBeNull();
    expect(parseReaisToCents('abc')).toBeUndefined();
    expect(parseReaisToCents('-5')).toBeUndefined();
    expect(parseReaisToCents('1,234')).toBeUndefined();
  });
  it('ida e volta pelo campo de edição preserva o valor', () => {
    expect(centsToReaisInput(123456)).toBe('1234,56');
    expect(centsToReaisInput(null)).toBe('');
    expect(parseReaisToCents(centsToReaisInput(4990))).toBe(4990);
  });
});

describe('categorias da oferta', () => {
  const catalog = [{ key: 'a', label: 'A' }, { key: 'b', label: 'B' }, { key: 'c', label: 'C' }];
  it('só oferece as categorias selecionadas na página, na ordem do catálogo', () => {
    expect(pageCategoryOptions(catalog, ['c', 'a']).map((c) => c.key)).toEqual(['a', 'c']);
  });
  it('rótulo da categoria cai na chave se sumiu do catálogo', () => {
    expect(categoryLabel(catalog, 'b')).toBe('B');
    expect(categoryLabel(catalog, 'x')).toBe('x');
    expect(categoryLabel(catalog, null)).toBeNull();
  });
});

describe('editar oferta', () => {
  it('título vazio, longo demais ou preço inválido são apontados', () => {
    const form = editFormFromOffer(offer);
    expect(validateEditOffer(form)).toEqual({});
    expect(validateEditOffer({ ...form, title: '  ' }).title).toBe(true);
    expect(validateEditOffer({ ...form, title: 'x'.repeat(141) }).title).toBe(true);
    expect(validateEditOffer({ ...form, price: 'abc', originalPrice: '1,2,3' })).toEqual({ price: true, originalPrice: true });
  });
  it('envia só o que mudou, com preço em centavos', () => {
    const form = editFormFromOffer(offer);
    expect(editOfferPatch(offer, form)).toBeNull();
    expect(editOfferPatch(offer, { ...form, title: ' Fone novo ', originalPrice: '79,90', category: 'a' }))
      .toEqual({ title: 'Fone novo', originalPriceCents: 7990, category: 'a' });
    expect(editOfferPatch(offer, { ...form, price: '' })).toEqual({ priceCents: null });
  });
});
