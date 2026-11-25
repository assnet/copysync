import { describe, it, expect } from 'vitest';
import { detectMarketplace, isSupportedProductUrl, kabumDestinationOf } from './detectMarketplace';

const u = (s: string) => new URL(s);

describe('detectMarketplace', () => {
  it('reconhece host exato e subdomínio', () => {
    expect(detectMarketplace(u('https://shopee.com.br/x'))).toBe('SHOPEE');
    expect(detectMarketplace(u('https://s.shopee.com.br/abc'))).toBe('SHOPEE');
    expect(detectMarketplace(u('https://shope.ee/abc'))).toBe('SHOPEE');
    expect(detectMarketplace(u('https://br.shp.ee/8pq7D1kb'))).toBe('SHOPEE');
    expect(detectMarketplace(u('https://produto.mercadolivre.com.br/MLB-1'))).toBe('MERCADO_LIVRE');
    expect(detectMarketplace(u('https://mercadolibre.com/x'))).toBe('MERCADO_LIVRE');
    expect(detectMarketplace(u('https://www.amazon.com.br/dp/X'))).toBe('AMAZON');
    expect(detectMarketplace(u('https://amzn.to/abc'))).toBe('AMAZON');
    expect(detectMarketplace(u('https://a.co/d/abc'))).toBe('AMAZON');
    expect(detectMarketplace(u('https://link.amazon/B00hBgkzm'))).toBe('AMAZON');
    expect(detectMarketplace(u('https://shoope.top/_c8d09838ba'))).toBe('SHOPEE');
    expect(detectMarketplace(u('https://evilshoope.top/x'))).toBeNull();
    expect(detectMarketplace(u('https://amzlinks.in/B00hBgkzm'))).toBe('AMAZON');
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

describe('detectMarketplace — Shein', () => {
  it.each([
    ['https://br.shein.com/Vestido-p-12345678.html', 'SHEIN'],
    ['https://m.shein.com/br/Vestido-p-12345678.html', 'SHEIN'],
    ['https://onelink.shein.com/60/abc', 'SHEIN'],
    ['https://us.shein.com/x-p-12345678.html', null],
    ['https://shein.com/x-p-12345678.html', null],
    ['https://evilshein.com/x', null],
    ['https://br.shein.com.evil.com/x', null],
  ] as const)('%s → %s', (url, expected) => {
    expect(detectMarketplace(u(url))).toBe(expected);
  });
});

const awin = (mid: string, ued: string, extra = '') =>
  `https://www.awin1.com/cread.php?awinmid=${mid}&awinaffid=1234567${extra}&ued=${encodeURIComponent(ued)}`;
const KABUM_PRODUCT = 'https://www.kabum.com.br/produto/123456/notebook-x';

describe('detectMarketplace — Kabum, Magalu e AliExpress', () => {
  it.each([
    [KABUM_PRODUCT, 'KABUM'],
    ['https://kabum.com.br/produto/123456', 'KABUM'],
    ['https://m.kabum.com.br/produto/123456', 'KABUM'],
    ['https://evilkabum.com.br/produto/123456', null],
    ['https://kabum.com.br.evil.com/produto/123456', null],
    [awin('17729', KABUM_PRODUCT), 'KABUM'],
    [awin('17729', KABUM_PRODUCT).replace('www.awin1.com', 'awin1.com'), 'KABUM'],
    [awin('99999', KABUM_PRODUCT), null],
    [awin('17729', 'https://www.exemplo.com.br/produto/1'), null],
    [awin('17729', 'https://evilkabum.com.br/produto/1'), null],
    [awin('17729', 'http://www.kabum.com.br/produto/1'), null],
    [awin('17729', 'nao-e-url'), null],
    [awin('17729', KABUM_PRODUCT, '&awinmid=99999'), null],
    ['https://www.awin1.com/cread.php?awinmid=17729&awinaffid=1', null],
    [awin('17729', KABUM_PRODUCT).replace('/cread.php', '/outra.php'), null],
    ['https://tidd.ly/3abcXYZ', null],
    ['https://www.magazineluiza.com.br/produto-x/p/240552500/cat/sub/', 'MAGALU'],
    ['https://www.magazinevoce.com.br/minhaloja/produto-x/p/dd90eh0e9b/cat/sub/', 'MAGALU'],
    ['https://evilmagazineluiza.com.br/x/p/1/', null],
    ['https://pt.aliexpress.com/item/1005001234567890.html', 'ALIEXPRESS'],
    ['https://aliexpress.com/item/1005001234567890.html', 'ALIEXPRESS'],
    ['https://s.click.aliexpress.com/e/_abc', 'ALIEXPRESS'],
    ['https://a.aliexpress.com/_abc', 'ALIEXPRESS'],
    ['https://www.aliexpress.us/item/1005001234567890.html', null],
    ['https://aliexpress.ru/item/1005001234567890.html', null],
    ['https://evilaliexpress.com/item/1.html', null],
  ] as const)('%s → %s', (url, expected) => {
    expect(detectMarketplace(u(url))).toBe(expected);
  });

  it('lê o destino do `ued` só da query, sem rede', () => {
    const before = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = (() => { calls += 1; throw new Error('sem rede'); }) as typeof fetch;
    try {
      expect(detectMarketplace(u(awin('17729', KABUM_PRODUCT)))).toBe('KABUM');
      expect(kabumDestinationOf(u(awin('17729', KABUM_PRODUCT)))?.toString()).toBe(KABUM_PRODUCT);
    } finally {
      globalThis.fetch = before;
    }
    expect(calls).toBe(0);
  });

  it('isSupportedProductUrl segue a mesma regra', () => {
    expect(isSupportedProductUrl(u(awin('17729', KABUM_PRODUCT)))).toBe(true);
    expect(isSupportedProductUrl(u(awin('99999', KABUM_PRODUCT)))).toBe(false);
    expect(isSupportedProductUrl(u('https://www.aliexpress.us/item/1.html'))).toBe(false);
  });
});
