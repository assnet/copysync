import { describe, expect, it } from 'vitest';
import { safeFindImageUrl } from './OfferHuntPresenter';

describe('safeFindImageUrl', () => {
  it('aceita só https em *.ltwebstatic.com', () => {
    expect(safeFindImageUrl('https://img.ltwebstatic.com/a.jpg')).toBe('https://img.ltwebstatic.com/a.jpg');
    expect(safeFindImageUrl('https://ltwebstatic.com/a.jpg')).toBe('https://ltwebstatic.com/a.jpg');
  });
  it.each([
    null, '', 'http://img.ltwebstatic.com/a.jpg', 'https://evil.com/a.jpg', 'https://ltwebstatic.com.evil.com/a.jpg',
    'https://xltwebstatic.com/a.jpg', 'https://u:p@img.ltwebstatic.com/a.jpg', 'https://img.ltwebstatic.com:8443/a.jpg',
    'javascript:alert(1)', 'lixo',
  ])('recusa %s', (v) => {
    expect(safeFindImageUrl(v)).toBeNull();
  });
});

describe('safeFindImageUrl por marca', () => {
  it('ML aceita só *.mlstatic.com; Shein recusa mlstatic e ML recusa ltwebstatic', () => {
    expect(safeFindImageUrl('https://http2.mlstatic.com/D_Q_NP_1.webp', 'MERCADO_LIVRE')).toBe('https://http2.mlstatic.com/D_Q_NP_1.webp');
    expect(safeFindImageUrl('https://http2.mlstatic.com/a.webp', 'SHEIN')).toBeNull();
    expect(safeFindImageUrl('https://img.ltwebstatic.com/a.jpg', 'MERCADO_LIVRE')).toBeNull();
    expect(safeFindImageUrl('http://http2.mlstatic.com/a.webp', 'MERCADO_LIVRE')).toBeNull();
    expect(safeFindImageUrl('https://mlstatic.com.evil.com/a.webp', 'MERCADO_LIVRE')).toBeNull();
  });
});
