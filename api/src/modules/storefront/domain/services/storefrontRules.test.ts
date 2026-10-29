import { describe, it, expect } from 'vitest';
import {
  STOREFRONT_IMAGE_PRESETS,
  STOREFRONT_MAX_OFFERS,
  STOREFRONT_MAX_PUBLISHED_OFFERS,
  STOREFRONT_SUBTITLE_SUGGESTIONS,
  STOREFRONT_SUBTITLE_MAX_LENGTH,
  keepOfferCategory,
  normalizeHexColor,
  validateOfferTitle,
  validatePriceCents,
  validateStorefrontCategories,
  validateStorefrontConfig,
  validateStorefrontName,
  validateStorefrontSubtitle,
} from './storefrontRules';

const MIB = 1024 * 1024;

describe('storefrontRules', () => {
  it('nome com 2–60 caracteres, aparado', () => {
    expect(validateStorefrontName('  Loja da Ana ')).toEqual({ kind: 'ok', value: 'Loja da Ana' });
    expect(validateStorefrontName('ab').kind).toBe('ok');
    expect(validateStorefrontName('a'.repeat(60)).kind).toBe('ok');
    expect(validateStorefrontName(' a ').kind).toBe('invalid');
    expect(validateStorefrontName('a'.repeat(61)).kind).toBe('invalid');
  });

  it('subtítulo opcional até 80; vazio vira null', () => {
    expect(validateStorefrontSubtitle(null)).toEqual({ kind: 'ok', value: null });
    expect(validateStorefrontSubtitle('   ')).toEqual({ kind: 'ok', value: null });
    expect(validateStorefrontSubtitle('a'.repeat(80)).kind).toBe('ok');
    expect(validateStorefrontSubtitle('a'.repeat(81)).kind).toBe('invalid');
  });

  it('4 sugestões de subtítulo que cabem no limite', () => {
    expect(STOREFRONT_SUBTITLE_SUGGESTIONS).toHaveLength(4);
    for (const s of STOREFRONT_SUBTITLE_SUGGESTIONS) {
      expect(validateStorefrontSubtitle(s)).toEqual({ kind: 'ok', value: s });
      expect(s.length).toBeLessThanOrEqual(STOREFRONT_SUBTITLE_MAX_LENGTH);
    }
  });

  it('título da oferta com 1–140 caracteres', () => {
    expect(validateOfferTitle(' Fone ')).toEqual({ kind: 'ok', value: 'Fone' });
    expect(validateOfferTitle('a'.repeat(140)).kind).toBe('ok');
    expect(validateOfferTitle('a'.repeat(141)).kind).toBe('invalid');
    expect(validateOfferTitle('  ').kind).toBe('invalid');
  });

  it('preço em centavos: inteiro ≥ 0 ou null', () => {
    expect(validatePriceCents(null)).toEqual({ kind: 'ok', value: null });
    expect(validatePriceCents(0)).toEqual({ kind: 'ok', value: 0 });
    expect(validatePriceCents(1999).kind).toBe('ok');
    expect(validatePriceCents(-1).kind).toBe('invalid');
    expect(validatePriceCents(10.5).kind).toBe('invalid');
    expect(validatePriceCents(Number.NaN).kind).toBe('invalid');
  });

  it('cor #RRGGBB normalizada em maiúsculas; resto rejeitado', () => {
    expect(normalizeHexColor(' #2563eb ')).toBe('#2563EB');
    expect(normalizeHexColor('#FFFFFF')).toBe('#FFFFFF');
    for (const bad of ['#fff', '2563eb', '#2563ebff', 'red', '#12345g', '#000;}body{', '']) {
      expect(normalizeHexColor(bad)).toBeNull();
    }
  });

  it('categorias ⊂ catálogo, sem duplicata, ordem preservada', () => {
    expect(validateStorefrontCategories(['pet_shop', 'electronics'])).toEqual({
      kind: 'ok',
      value: ['pet_shop', 'electronics'],
    });
    expect(validateStorefrontCategories([])).toEqual({ kind: 'ok', value: [] });
    expect(validateStorefrontCategories(['pet_shop', 'pet_shop']).kind).toBe('invalid');
    expect(validateStorefrontCategories(['moda']).kind).toBe('invalid');
  });

  it('categoria da oferta fora das categorias da página vira "Sem categoria"', () => {
    expect(keepOfferCategory('pet_shop', ['pet_shop'])).toBe('pet_shop');
    expect(keepOfferCategory('pet_shop', ['electronics'])).toBeNull();
    expect(keepOfferCategory(null, ['electronics'])).toBeNull();
  });

  it('config completa: devolve normalizado ou o primeiro campo inválido', () => {
    const base = {
      title: ' Loja ',
      subtitle: '',
      colorPrimary: '#2563eb',
      colorBackground: '#f5f5f5',
      colorCard: '#ffffff',
      categories: ['electronics'],
    };
    expect(validateStorefrontConfig(base)).toEqual({
      kind: 'ok',
      value: {
        title: 'Loja',
        subtitle: null,
        colorPrimary: '#2563EB',
        colorBackground: '#F5F5F5',
        colorCard: '#FFFFFF',
        categories: ['electronics'],
      },
    });
    expect(validateStorefrontConfig({ ...base, title: 'a' })).toEqual({ kind: 'invalid', field: 'title' });
    expect(validateStorefrontConfig({ ...base, colorCard: 'url(x)' })).toEqual({ kind: 'invalid', field: 'colorCard' });
    expect(validateStorefrontConfig({ ...base, categories: ['x'] })).toEqual({ kind: 'invalid', field: 'categories' });
  });

  it('limites de ofertas: 200 no total, 60 publicadas', () => {
    expect(STOREFRONT_MAX_OFFERS).toBe(200);
    expect(STOREFRONT_MAX_PUBLISHED_OFFERS).toBe(60);
  });

  it('presets de imagem conforme a regra visível no painel', () => {
    expect(STOREFRONT_IMAGE_PRESETS.avatar).toEqual({
      maxInputBytes: 2 * MIB,
      minWidth: 200,
      minHeight: 200,
      output: { width: 320, height: 320, fit: 'cover' },
    });
    expect(STOREFRONT_IMAGE_PRESETS.cover).toEqual({
      maxInputBytes: 4 * MIB,
      minWidth: 1200,
      minHeight: 400,
      output: { width: 1500, height: 500, fit: 'cover' },
    });
    expect(STOREFRONT_IMAGE_PRESETS.offer).toEqual({
      maxInputBytes: 5 * MIB,
      minWidth: 0,
      minHeight: 0,
      output: { width: 600, height: 600, fit: 'inside' },
    });
  });
});
