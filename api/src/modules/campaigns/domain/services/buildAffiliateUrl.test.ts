import { describe, it, expect } from 'vitest';
import { buildAmazonAffiliateUrl, buildMercadoLivreAffiliateUrl } from './buildAffiliateUrl';

describe('buildAmazonAffiliateUrl', () => {
  it('monta URL canônica com tag codificada', () => {
    expect(buildAmazonAffiliateUrl('B0ABC12345', 'loja-20')).toBe('https://www.amazon.com.br/dp/B0ABC12345?tag=loja-20');
    expect(buildAmazonAffiliateUrl('B0ABC12345', 'a&b')).toBe('https://www.amazon.com.br/dp/B0ABC12345?tag=a%26b');
  });
});

describe('buildMercadoLivreAffiliateUrl', () => {
  it('troca query e hash pelo matt_word', () => {
    const url = new URL('https://produto.mercadolivre.com.br/MLB-1-fone?matt_word=outro&x=1#reviews');
    expect(buildMercadoLivreAffiliateUrl(url, 'minha tag')).toBe(
      'https://produto.mercadolivre.com.br/MLB-1-fone?matt_word=minha%20tag',
    );
  });
});
