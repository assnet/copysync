import { describe, it, expect } from 'vitest';
import { affiliateIdentifierOf, verifyAffiliateLink } from './verifyAffiliateLink';

const u = (s: string) => new URL(s);

describe('verifyAffiliateLink', () => {
  it.each([
    ['AMAZON', 'https://www.amazon.com.br/dp/B0ABCDEFGH?tag=loja-20', 'loja-20', 'verified'],
    ['AMAZON', 'https://www.amazon.com.br/dp/B0ABCDEFGH?TAG=Loja-20', 'loja-20', 'verified'],
    ['AMAZON', 'https://www.amazon.com.br/dp/B0ABCDEFGH?tag=outra-20', 'loja-20', 'not_owned'],
    ['AMAZON', 'https://www.amazon.com.br/dp/B0ABCDEFGH', 'loja-20', 'not_affiliate'],
    ['AMAZON', 'https://www.amazon.com.br/dp/B0ABCDEFGH?tag=', null, 'not_affiliate'],
    ['AMAZON', 'https://www.amazon.com.br/dp/B0ABCDEFGH?tag=x-20', null, 'unverified'],
    ['MERCADO_LIVRE', 'https://produto.mercadolivre.com.br/MLB-1-x?matt_word=etq', 'etq', 'verified'],
    ['MERCADO_LIVRE', 'https://www.mercadolivre.com.br/social/etq?matt_word=etq', 'etq', 'verified'],
    ['MERCADO_LIVRE', 'https://www.mercadolivre.com.br/social/etq', 'etq', 'verified'],
    ['MERCADO_LIVRE', 'https://www.mercadolivre.com.br/social/outra', 'etq', 'not_owned'],
    ['MERCADO_LIVRE', 'https://produto.mercadolivre.com.br/MLB-1-x', 'etq', 'not_affiliate'],
    ['SHOPEE', 'https://shopee.com.br/x-i.1.2', '123', 'unverified'],
  ] as const)('%s %s (cred %s) → %s', (provider, url, cred, expected) => {
    expect(verifyAffiliateLink(provider, u(url), cred)).toBe(expected);
  });

  it('path social malformado não lança', () => {
    expect(affiliateIdentifierOf('MERCADO_LIVRE', u('https://www.mercadolivre.com.br/social/%E0%A4%A'))).toBe('%E0%A4%A');
  });
});

describe('verifyAffiliateLink — identificadores divergentes', () => {
  it.each([
    ['AMAZON', 'https://www.amazon.com.br/dp/B0ABCDEFGH?tag=loja-20&tag=outra-20', 'loja-20', 'not_owned'],
    ['AMAZON', 'https://www.amazon.com.br/dp/B0ABCDEFGH?tag=loja-20&TAG=LOJA-20', 'loja-20', 'verified'],
    ['AMAZON', 'https://www.amazon.com.br/dp/B0ABCDEFGH?tag=a-20&tag=b-20', null, 'not_owned'],
    ['MERCADO_LIVRE', 'https://x.mercadolivre.com.br/MLB-1?matt_word=etq&matt_word=outra', 'etq', 'not_owned'],
    ['MERCADO_LIVRE', 'https://www.mercadolivre.com.br/social/etq?matt_word=outra', 'etq', 'not_owned'],
    ['MERCADO_LIVRE', 'https://www.mercadolivre.com.br/social/ETQ?matt_word=etq', 'etq', 'verified'],
  ] as const)('%s %s (cred %s) → %s', (provider, url, cred, expected) => {
    expect(verifyAffiliateLink(provider, u(url), cred)).toBe(expected);
  });

  it('URL colada e expandida juntas: divergência → not_owned', () => {
    const pasted = u('https://www.amazon.com.br/dp/B0ABCDEFGH?tag=loja-20');
    expect(verifyAffiliateLink('AMAZON', [pasted, u('https://www.amazon.com.br/dp/B0ABCDEFGH?tag=outra-20')], 'loja-20')).toBe('not_owned');
    expect(verifyAffiliateLink('AMAZON', [pasted, u('https://www.amazon.com.br/dp/B0ABCDEFGH')], 'loja-20')).toBe('verified');
    expect(verifyAffiliateLink('AMAZON', [u('https://amzn.to/x'), u('https://www.amazon.com.br/dp/B0?tag=loja-20')], 'loja-20')).toBe('verified');
  });
});
