import { describe, it, expect } from 'vitest';
import { affiliateIdentifierOf, ownershipIdentifiersOf, verifyAffiliateLink } from './verifyAffiliateLink';

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

describe('verifyAffiliateLink — Shein', () => {
  const P = 'https://br.shein.com/x-p-12345678.html';
  it.each([
    [`${P}?url_from=affiliate_koc_123456`, '123456', 'verified'],
    [`${P}?url_from=affiliate_koc_123456`, '999999', 'not_owned'],
    [`${P}?url_from=affiliate_koc_123456`, null, 'unverified'],
    [`${P}?url_from=GM7654321`, '123456', 'not_affiliate'],
    [P, '123456', 'not_affiliate'],
    [`${P}?url_from=affiliate_koc_123456&url_from=affiliate_koc_654321`, '123456', 'not_owned'],
  ] as const)('%s (cred %s) → %s', (url, cred, expected) => {
    expect(verifyAffiliateLink('SHEIN', u(url), cred)).toBe(expected);
  });

  it('lê só o id do `url_from`', () => {
    expect(affiliateIdentifierOf('SHEIN', u(`${P}?url_from=affiliate_koc_123456`))).toBe('123456');
    expect(affiliateIdentifierOf('SHEIN', u(`${P}?url_from=GM7654321`))).toBeNull();
  });

  it('colado e expandido com ids divergentes → not_owned', () => {
    const urls = [u(`${P}?url_from=affiliate_koc_123456`), u(`${P}?url_from=affiliate_koc_654321`)];
    expect(verifyAffiliateLink('SHEIN', urls, '123456')).toBe('not_owned');
  });
});

describe('verifyAffiliateLink — ML: matt_word tem precedência sobre /social/<apelido>', () => {
  const SOCIAL = 'https://www.mercadolivre.com.br/social/sevenclub?matt_word=sevenclub2025';

  it('apelido do perfil ≠ etiqueta, matt_word = credencial → verified', () => {
    expect(verifyAffiliateLink('MERCADO_LIVRE', u(SOCIAL), 'sevenclub2025')).toBe('verified');
  });

  it('mesmo link com credencial de outra conta → not_owned', () => {
    expect(verifyAffiliateLink('MERCADO_LIVRE', u(SOCIAL), 'outraetq')).toBe('not_owned');
    expect(verifyAffiliateLink('MERCADO_LIVRE', u(SOCIAL), 'sevenclub')).toBe('not_owned');
  });

  it('meli.la colado + final social com apelido ≠ etiqueta → verified', () => {
    const urls = [u('https://meli.la/x'), u('https://www.mercadolivre.com.br/social/apelido?matt_word=etq')];
    expect(verifyAffiliateLink('MERCADO_LIVRE', urls, 'etq')).toBe('verified');
  });

  it('dois matt_word distintos (mesma URL ou entre colada e final) → not_owned', () => {
    expect(verifyAffiliateLink('MERCADO_LIVRE', u('https://www.mercadolivre.com.br/social/a?matt_word=etq&matt_word=outra'), 'etq')).toBe('not_owned');
    const urls = [u('https://produto.mercadolivre.com.br/MLB-1?matt_word=etq'), u('https://www.mercadolivre.com.br/social/etq?matt_word=outra')];
    expect(verifyAffiliateLink('MERCADO_LIVRE', urls, 'etq')).toBe('not_owned');
  });

  it('/social/<x> sem matt_word em nenhuma URL segue valendo', () => {
    expect(verifyAffiliateLink('MERCADO_LIVRE', [u('https://meli.la/x'), u('https://www.mercadolivre.com.br/social/etq')], 'etq')).toBe('verified');
    expect(verifyAffiliateLink('MERCADO_LIVRE', [u('https://meli.la/x'), u('https://www.mercadolivre.com.br/social/outra')], 'etq')).toBe('not_owned');
  });

  it('ownershipIdentifiersOf: matt_word de qualquer URL descarta todos os /social/<x>', () => {
    const urls = [u('https://www.mercadolivre.com.br/social/apelido'), u('https://x.mercadolivre.com.br/MLB-1?matt_word=etq')];
    expect(ownershipIdentifiersOf('MERCADO_LIVRE', urls)).toEqual(['etq']);
    expect(ownershipIdentifiersOf('MERCADO_LIVRE', [u('https://www.mercadolivre.com.br/social/apelido')])).toEqual(['apelido']);
    expect(ownershipIdentifiersOf('AMAZON', [u('https://amzn.to/x'), u('https://www.amazon.com.br/dp/B0?tag=a-20')])).toEqual(['a-20']);
  });
  it('conjunto de identificadores: verified se o único do link estiver nele (sem caixa)', () => {
    const link = [u('https://x.mercadolivre.com.br/MLB-1?matt_word=Segunda')];
    expect(verifyAffiliateLink('MERCADO_LIVRE', link, ['principal', 'segunda'])).toBe('verified');
    expect(verifyAffiliateLink('MERCADO_LIVRE', link, ['principal'])).toBe('not_owned');
    expect(verifyAffiliateLink('MERCADO_LIVRE', link, [])).toBe('unverified');
    expect(verifyAffiliateLink('MERCADO_LIVRE', link, ['  '])).toBe('unverified');
    const two = [u('https://x.mercadolivre.com.br/MLB-1?matt_word=principal&matt_word=segunda')];
    expect(verifyAffiliateLink('MERCADO_LIVRE', two, ['principal', 'segunda'])).toBe('not_owned');
  });
});
