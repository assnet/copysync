import { describe, it, expect } from 'vitest';
import { detectMarketplace, isSupportedProductUrl } from './detectMarketplace';

const u = (s: string) => new URL(s);

describe('detectMarketplace', () => {
  it('reconhece host exato e subdomínio', () => {
    expect(detectMarketplace(u('https://shopee.com.br/x'))).toBe('SHOPEE');
    expect(detectMarketplace(u('https://s.shopee.com.br/abc'))).toBe('SHOPEE');
    expect(detectMarketplace(u('https://shope.ee/abc'))).toBe('SHOPEE');
    expect(detectMarketplace(u('https://produto.mercadolivre.com.br/MLB-1'))).toBe('MERCADO_LIVRE');
    expect(detectMarketplace(u('https://mercadolibre.com/x'))).toBe('MERCADO_LIVRE');
    expect(detectMarketplace(u('https://www.amazon.com.br/dp/X'))).toBe('AMAZON');
    expect(detectMarketplace(u('https://amzn.to/abc'))).toBe('AMAZON');
  });

  it('ignora caixa e ponto final do host', () => {
    expect(detectMarketplace(u('https://WWW.Amazon.COM.BR./dp/X'))).toBe('AMAZON');
  });

  it('não casa sufixo sem ponto nem host fora da allowlist', () => {
    expect(detectMarketplace(u('https://evilshopee.com.br/x'))).toBeNull();
    expect(detectMarketplace(u('https://shopee.com.br.evil.com/x'))).toBeNull();
    expect(detectMarketplace(u('https://amazon.com/dp/X'))).toBeNull();
  });
});

describe('isSupportedProductUrl', () => {
  it('aceita https de marketplace conhecido', () => {
    expect(isSupportedProductUrl(u('https://shopee.com.br/p-i.1.2'))).toBe(true);
  });

  it('recusa esquema, porta, userinfo e IP', () => {
    expect(isSupportedProductUrl(u('http://shopee.com.br/x'))).toBe(false);
    expect(isSupportedProductUrl(u('https://shopee.com.br:8443/x'))).toBe(false);
    expect(isSupportedProductUrl(u('https://a:b@shopee.com.br/x'))).toBe(false);
    expect(isSupportedProductUrl(u('https://a@shopee.com.br/x'))).toBe(false);
    expect(isSupportedProductUrl(u('https://127.0.0.1/x'))).toBe(false);
    expect(isSupportedProductUrl(u('https://[::1]/x'))).toBe(false);
    expect(isSupportedProductUrl(u('https://exemplo.com/x'))).toBe(false);
  });

  it('porta padrão 443 é normalizada e aceita', () => {
    expect(isSupportedProductUrl(u('https://shopee.com.br:443/x'))).toBe(true);
  });
});
