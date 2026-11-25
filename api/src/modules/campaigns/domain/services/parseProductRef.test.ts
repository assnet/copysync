import { describe, it, expect } from 'vitest';
import { parseProductRef } from './parseProductRef';

const u = (s: string) => new URL(s);

describe('parseProductRef — Shopee', () => {
  it('lê o slug `-i.shop.item`', () => {
    expect(parseProductRef('SHOPEE', u('https://shopee.com.br/Fone-Bluetooth-i.123.456?sp_atk=x'))).toEqual({
      provider: 'SHOPEE',
      shopId: '123',
      itemId: '456',
    });
  });

  it('lê `/product/` e `/opaanlp/`', () => {
    expect(parseProductRef('SHOPEE', u('https://shopee.com.br/product/11/22'))).toMatchObject({ shopId: '11', itemId: '22' });
    expect(parseProductRef('SHOPEE', u('https://shopee.com.br/opaanlp/33/44'))).toMatchObject({ shopId: '33', itemId: '44' });
  });

  it('cai para a query, sem diferenciar caixa', () => {
    expect(parseProductRef('SHOPEE', u('https://shopee.com.br/x?shopId=5&ItemID=6'))).toMatchObject({ shopId: '5', itemId: '6' });
  });

  it('sem padrão reconhecido devolve null', () => {
    expect(parseProductRef('SHOPEE', u('https://shopee.com.br/loja'))).toBeNull();
    expect(parseProductRef('SHOPEE', u('https://shopee.com.br/x?shopid=a&itemid=1'))).toBeNull();
  });
});

describe('parseProductRef — Amazon', () => {
  it('lê o ASIN dos formatos conhecidos, em caixa alta', () => {
    for (const path of ['/Fone/dp/b0abc12345', '/gp/product/B0ABC12345', '/gp/aw/d/B0ABC12345/', '/exec/obidos/ASIN/B0ABC12345']) {
      expect(parseProductRef('AMAZON', u(`https://www.amazon.com.br${path}?th=1`))).toEqual({ provider: 'AMAZON', asin: 'B0ABC12345' });
    }
  });

  it('recusa ASIN com tamanho errado', () => {
    expect(parseProductRef('AMAZON', u('https://www.amazon.com.br/dp/B0ABC1234'))).toBeNull();
    expect(parseProductRef('AMAZON', u('https://www.amazon.com.br/dp/B0ABC123456'))).toBeNull();
  });
});

describe('parseProductRef — Mercado Livre', () => {
  it('produto de catálogo `/p/MLB…`', () => {
    expect(parseProductRef('MERCADO_LIVRE', u('https://www.mercadolivre.com.br/fone/p/mlb19876'))).toEqual({
      provider: 'MERCADO_LIVRE',
      itemId: 'MLB19876',
      catalog: true,
    });
  });

  it('anúncio `MLB-123` normaliza para `MLB123`', () => {
    expect(parseProductRef('MERCADO_LIVRE', u('https://produto.mercadolivre.com.br/MLB-123456-fone-_JM'))).toEqual({
      provider: 'MERCADO_LIVRE',
      itemId: 'MLB123456',
      catalog: false,
    });
  });

  it('sem id devolve null', () => {
    expect(parseProductRef('MERCADO_LIVRE', u('https://www.mercadolivre.com.br/ofertas'))).toBeNull();
  });
});

describe('parseProductRef — Shein', () => {
  it.each([
    ['https://br.shein.com/Vestido-Floral-p-12345678.html', '12345678'],
    ['https://br.shein.com/Vestido-Floral-p-12345678-cat-1727.html?url_from=affiliate_koc_99', '12345678'],
    ['https://m.shein.com/br/Vestido-p-87654321-cat-2.html', '87654321'],
    ['https://br.shein.com/x?goods_id=4455667', '4455667'],
  ])('%s → %s', (url, goodsId) => {
    expect(parseProductRef('SHEIN', u(url))).toEqual({ provider: 'SHEIN', goodsId });
  });

  it.each([
    'https://m.shein.com/us/Vestido-p-12345678.html',
    'https://m.shein.com/Vestido-p-12345678.html',
    'https://br.shein.com/Vestido-p-123.html',
    'https://br.shein.com/x?goods_id=abc',
    'https://br.shein.com/promo',
  ])('recusa %s', (url) => {
    expect(parseProductRef('SHEIN', u(url))).toBeNull();
  });
});

const awin = (mid: string, ued: string) =>
  `https://www.awin1.com/cread.php?awinmid=${mid}&awinaffid=1234567&ued=${encodeURIComponent(ued)}`;

describe('parseProductRef — Kabum', () => {
  it.each([
    ['https://www.kabum.com.br/produto/123456/notebook-x', '123456'],
    ['https://www.kabum.com.br/produto/123456', '123456'],
    [awin('17729', 'https://www.kabum.com.br/produto/987654/placa-y?x=1'), '987654'],
  ])('%s → %s', (url, productId) => {
    expect(parseProductRef('KABUM', u(url))).toEqual({ provider: 'KABUM', productId });
  });

  it.each([
    'https://www.kabum.com.br/hardware/placa-de-video',
    'https://www.kabum.com.br/busca/produto/123',
    awin('99999', 'https://www.kabum.com.br/produto/987654'),
    awin('17729', 'https://www.exemplo.com.br/produto/987654'),
    awin('17729', 'https://evilkabum.com.br/produto/987654'),
    'https://www.awin1.com/cread.php?awinmid=17729&awinaffid=1',
  ])('recusa %s', (url) => {
    expect(parseProductRef('KABUM', u(url))).toBeNull();
  });
});

describe('parseProductRef — Magalu', () => {
  it('magazineluiza: SKU e caminho inteiro', () => {
    expect(parseProductRef('MAGALU', u('https://www.magazineluiza.com.br/geladeira-x/p/240552500/ed/refr/?seller_id=a'))).toEqual({
      provider: 'MAGALU', sku: '240552500', path: '/geladeira-x/p/240552500/ed/refr/',
    });
  });

  it('magazinevoce: caminho sem o segmento da loja', () => {
    expect(parseProductRef('MAGALU', u('https://www.magazinevoce.com.br/minhaloja/tenis-y/p/dd90eh0e9b/es/tens'))).toEqual({
      provider: 'MAGALU', sku: 'dd90eh0e9b', path: '/tenis-y/p/dd90eh0e9b/es/tens',
    });
  });

  it.each([
    'https://www.magazinevoce.com.br/minhaloja/',
    'https://www.magazinevoce.com.br/p/240552500/',
    'https://www.magazineluiza.com.br/busca/geladeira/',
    'https://www.exemplo.com.br/x/p/240552500/',
  ])('recusa %s', (url) => {
    expect(parseProductRef('MAGALU', u(url))).toBeNull();
  });
});

describe('parseProductRef — AliExpress', () => {
  it.each([
    'https://pt.aliexpress.com/item/1005001234567890.html?spm=x',
    'https://www.aliexpress.com/item/1005001234567890.html',
  ])('%s', (url) => {
    expect(parseProductRef('ALIEXPRESS', u(url))).toEqual({ provider: 'ALIEXPRESS', productId: '1005001234567890' });
  });

  it.each([
    'https://pt.aliexpress.com/store/123',
    'https://s.click.aliexpress.com/e/_abc',
    'https://www.aliexpress.us/item/1005001234567890.html',
  ])('recusa %s', (url) => {
    expect(parseProductRef('ALIEXPRESS', u(url))).toBeNull();
  });
});
