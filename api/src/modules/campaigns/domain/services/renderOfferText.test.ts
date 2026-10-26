import { describe, it, expect } from 'vitest';
import { renderOfferText } from './renderOfferText';

describe('renderOfferText', () => {
  it('preenche o modelo padrão com preço pt-BR e desconto', () => {
    const text = renderOfferText({
      title: 'Fone Bluetooth',
      priceCents: 6499,
      originalPriceCents: 9999,
      affiliateUrl: 'https://s.shopee.com.br/abc',
    });
    expect(text).toBe(
      ['🔥 Fone Bluetooth', '', '~De R$ 99,99~', '✅ Por R$ 64,99', '📉 35% OFF', '', '🛒 https://s.shopee.com.br/abc'].join('\n'),
    );
  });

  it('usa espaço comum e milhar com ponto', () => {
    const text = renderOfferText({ priceCents: 123456, affiliateUrl: 'x' }, '{preco}');
    expect(text).toBe('R$ 1.234,56');
    expect(text).not.toMatch(/ /);
  });

  it('sem preço original some a linha "De" e a de desconto', () => {
    const text = renderOfferText({ title: 'Item', priceCents: 1000, affiliateUrl: 'L' });
    expect(text).toBe(['🔥 Item', '', '✅ Por R$ 10,00', '', '🛒 L'].join('\n'));
  });

  it('original menor ou igual ao preço não vira desconto', () => {
    const text = renderOfferText({ priceCents: 1000, originalPriceCents: 1000, affiliateUrl: 'L' });
    expect(text).toBe(['✅ Por R$ 10,00', '', '🛒 L'].join('\n'));
  });

  it('só com link sobra só o link', () => {
    expect(renderOfferText({ title: '  ', affiliateUrl: 'L' })).toBe('🛒 L');
  });

  it('mantém texto fixo e linha com marcador parcialmente preenchido', () => {
    const text = renderOfferText({ title: 'X', affiliateUrl: 'L' }, 'Oferta!\n{titulo} por {preco}\n\n\n{link}');
    expect(text).toBe('Oferta!\nX por\n\nL');
  });
});
