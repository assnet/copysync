import { describe, it, expect } from 'vitest';
import { normalizeSlug, validateSlug, suggestSlugs, SLUG_PATTERN, MAX_SLUG_SUGGESTIONS } from './slugRules';

describe('slugRules', () => {
  it('normaliza acento, caixa, espaço/underscore e hífens', () => {
    expect(normalizeSlug('  Promoção_de  Mãe--1 ')).toBe('promocao-de-mae-1');
    expect(normalizeSlug('-Ofertas-')).toBe('ofertas');
  });

  it.each(['ab', 'a'.repeat(51), 'promo!', 'promo.top', '', '---'])('"%s" é inválido', (raw) => {
    expect(validateSlug(raw).kind).toBe('invalid');
  });

  it('aceita 3 e 50 caracteres', () => {
    expect(validateSlug('abc')).toEqual({ kind: 'ok', slug: 'abc' });
    expect(validateSlug('a'.repeat(50)).kind).toBe('ok');
  });

  it('reservados padrão e do domínio', () => {
    expect(validateSlug('WWW').kind).toBe('reserved');
    expect(validateSlug('probe').kind).toBe('reserved');
    expect(validateSlug('loja', ['Loja']).kind).toBe('reserved');
    expect(validateSlug('loja').kind).toBe('ok');
  });

  it('sugestões válidas, únicas, até o limite e diferentes da base', () => {
    const out = suggestSlugs('Promo Mãe');
    expect(out).toHaveLength(MAX_SLUG_SUGGESTIONS);
    expect(new Set(out).size).toBe(out.length);
    expect(out).not.toContain('promo-mae');
    for (const s of out) expect(SLUG_PATTERN.test(s)).toBe(true);
    expect(out[0]).toBe('promo-mae-oficial');
  });

  it('sugestões pulam ocupadas e reservadas e cabem em 50', () => {
    const taken = new Set(['promo-oficial', 'promo2']);
    const out = suggestSlugs('promo', { isTaken: (s) => taken.has(s), extraReserved: ['promo-vip'] });
    expect(out).toEqual(['promo3', 'promo4', 'promo5', 'promo6', 'promo7']);
    const long = suggestSlugs('a'.repeat(50));
    for (const s of long) expect(s.length).toBeLessThanOrEqual(50);
  });

  it('base curta ou vazia ainda gera sugestão válida', () => {
    expect(suggestSlugs('a')[0]).toBe('a-oficial');
    expect(suggestSlugs('!!')[0]).toBe('link-oficial');
  });
});
