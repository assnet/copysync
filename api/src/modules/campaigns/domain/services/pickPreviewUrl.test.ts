import { describe, expect, it } from 'vitest';
import { pickPreviewUrl } from './pickPreviewUrl';

const AFF = 'https://amzn.to/abc123';

describe('pickPreviewUrl', () => {
  it('link no fim com 🛒 (modelo padrão)', () => {
    expect(pickPreviewUrl(`🔥 Fone\n✅ Por R$ 10\n\n🛒 ${AFF}`, AFF)).toBe(AFF);
    // Emoji colado no link
    expect(pickPreviewUrl(`🛒${AFF}`, AFF)).toBe(AFF);
  });

  it('vários links: prefere o affiliateUrl mesmo fora da 1ª posição', () => {
    const text = `Veja https://meli.la/xyz\nOutra: ${AFF}\nE https://s.shopee.com.br/q`;
    expect(pickPreviewUrl(text, AFF)).toBe(AFF);
  });

  it('affiliateUrl ausente do texto: primeiro link', () => {
    expect(pickPreviewUrl('A https://meli.la/xyz e https://amzn.to/zzz', AFF)).toBe('https://meli.la/xyz');
    expect(pickPreviewUrl('A https://meli.la/xyz', null)).toBe('https://meli.la/xyz');
    expect(pickPreviewUrl('A https://meli.la/xyz', undefined)).toBe('https://meli.la/xyz');
  });

  it('affiliateUrl prefixo de outro link não conta como presente', () => {
    expect(pickPreviewUrl(`https://meli.la/a ${AFF}456`, AFF)).toBe('https://meli.la/a');
  });

  it('texto sem link → null', () => {
    expect(pickPreviewUrl('Oferta sem link', AFF)).toBeNull();
    expect(pickPreviewUrl('', null)).toBeNull();
    // Domínio solto sem protocolo não vira prévia
    expect(pickPreviewUrl('amzn.to/abc', null)).toBeNull();
  });

  it('pontuação e markdown colados no fim saem', () => {
    expect(pickPreviewUrl(`Compre aqui: ${AFF}.`, AFF)).toBe(AFF);
    expect(pickPreviewUrl(`(${AFF})`, AFF)).toBe(AFF);
    expect(pickPreviewUrl(`_${AFF}_!`, AFF)).toBe(AFF);
    expect(pickPreviewUrl('Link: https://meli.la/xyz,', null)).toBe('https://meli.la/xyz');
  });

  it('affiliateUrl com espaços nas pontas', () => {
    expect(pickPreviewUrl(`🛒 ${AFF}`, `  ${AFF}\n`)).toBe(AFF);
  });
});
