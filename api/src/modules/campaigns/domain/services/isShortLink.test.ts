import { describe, it, expect } from 'vitest';
import { isShortLink, SHORT_HOSTS } from './isShortLink';

describe('isShortLink', () => {
  it.each([
    ['https://meli.la/abc', true],
    ['https://MELI.LA/abc', true],
    ['https://s.shopee.com.br/x', true],
    ['https://amzn.to/x', true],
    ['https://onelink.shein.com/x/y', true],
    ['https://mercadolivre.com/sec/abc', true],
    ['https://mercadolivre.com/social/etq', true],
    ['https://mercadolivre.com/outro', false],
    ['https://www.mercadolivre.com.br/social/etq?matt_word=etq', false],
    ['https://produto.mercadolivre.com.br/MLB-1-x', false],
    ['https://www.amazon.com.br/dp/B0ABCDEFGH', false],
    ['https://shopee.com.br/x-i.1.2', false],
  ] as const)('%s → %s', (url, expected) => {
    expect(isShortLink(new URL(url))).toBe(expected);
  });

  it('todo host da lista é curto', () => {
    for (const host of SHORT_HOSTS) expect(isShortLink(new URL(`https://${host}/x`))).toBe(true);
  });
});
