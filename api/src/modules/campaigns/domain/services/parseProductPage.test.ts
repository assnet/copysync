import { describe, it, expect } from 'vitest';
import { decodeHtmlEntities, parsePriceToCents, parseProductPage } from './parseProductPage';

describe('parsePriceToCents', () => {
  it.each([
    ['123.45', 12345],
    ['123,45', 12345],
    ['1.234,56', 123456],
    ['1,234.56', 123456],
    ['R$ 1.234', 123400],
    ['R$ 89,9', 8990],
    [49.9, 4990],
    ['', null],
    ['abc', null],
    [null, null],
  ])('%s → %s', (raw, cents) => {
    expect(parsePriceToCents(raw)).toBe(cents);
  });
});

describe('decodeHtmlEntities', () => {
  it('nomeadas e numéricas', () => {
    expect(decodeHtmlEntities('A &amp; B &quot;x&quot; &#39;y&#x27; &atilde;')).toBe('A & B "x" \'y\' &atilde;');
  });
});

describe('parseProductPage', () => {
  it('og:* + product:price:amount', () => {
    const html = `<head><meta content="Fone &amp; Cia" property="og:title"><meta property="og:image" content="https://m.media-amazon.com/i.jpg"><meta property="product:price:amount" content="59.90"></head>`;
    expect(parseProductPage('AMAZON', html)).toEqual({
      title: 'Fone & Cia', imageUrl: 'https://m.media-amazon.com/i.jpg', priceCents: 5990, originalPriceCents: null, productRef: null,
    });
  });

  it('JSON-LD Product (em @graph) com price e highPrice', () => {
    const ld = { '@context': 'https://schema.org', '@graph': [{ '@type': 'WebPage' }, { '@type': 'Product', name: 'Panela', image: ['https://http2.mlstatic.com/p.jpg'], offers: { '@type': 'AggregateOffer', lowPrice: '89.9', highPrice: 120 } }] };
    const html = `<script type="application/ld+json">${JSON.stringify(ld)}</script><title>Outro</title>`;
    expect(parseProductPage('MERCADO_LIVRE', html)).toMatchObject({
      title: 'Panela', imageUrl: 'https://http2.mlstatic.com/p.jpg', priceCents: 8990, originalPriceCents: 12000,
    });
  });

  it('JSON-LD inválido é ignorado; cai no <title>', () => {
    expect(parseProductPage('SHOPEE', '<script type="application/ld+json">{x</script><title> Produto  Y </title>').title).toBe('Produto Y');
  });

  it('ML: andes-money-amount atual e anterior; product_id da página social', () => {
    const html = `
      <s class="andes-money-amount ui-pdp-price__original-value andes-money-amount--previous"><span class="andes-money-amount__currency-symbol">R$</span><span class="andes-money-amount__fraction">1.299</span></s>
      <span class="andes-money-amount ui-pdp-price__part andes-money-amount--cents-superscript"><span class="andes-money-amount__currency-symbol">R$</span><span class="andes-money-amount__fraction">999</span><span class="andes-money-amount__cents andes-money-amount__cents--superscript-36">90</span></span>
      <script>{"items":[{"product_id":"mlb12345","x":1}]}</script>`;
    expect(parseProductPage('MERCADO_LIVRE', html)).toMatchObject({ priceCents: 99990, originalPriceCents: 129900, productRef: 'MLB12345' });
  });

  it('Amazon: productTitle, a-offscreen, preço riscado e data-old-hires', () => {
    const html = `<span id="productTitle" class="a-size-large">  Kindle 11ª geração </span>
      <span class="a-price"><span class="a-offscreen">R$&nbsp;499,00</span></span>
      <span class="a-price a-text-price" data-a-strike="true"><span class="a-offscreen">R$&nbsp;599,00</span></span>
      <img id="landingImage" data-old-hires="https://m.media-amazon.com/images/I/k.jpg">`;
    expect(parseProductPage('AMAZON', html)).toEqual({
      title: 'Kindle 11ª geração', imageUrl: 'https://m.media-amazon.com/images/I/k.jpg', priceCents: 49900, originalPriceCents: 59900, productRef: null,
    });
  });

  it('preço anterior ≤ atual é descartado; imagem não-https descartada', () => {
    const html = '<meta property="og:image" content="http://x/a.jpg"><script type="application/ld+json">{"@type":"Product","name":"A","offers":{"price":10,"highPrice":10}}</script>';
    expect(parseProductPage('SHOPEE', html)).toMatchObject({ priceCents: 1000, originalPriceCents: null, imageUrl: null });
  });

  it('página vazia → tudo null', () => {
    expect(parseProductPage('AMAZON', '')).toEqual({ title: null, imageUrl: null, priceCents: null, originalPriceCents: null, productRef: null });
  });
});
