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
