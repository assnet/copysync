import { describe, expect, it } from 'vitest';
import { detectCoupon, extractUrls, matchesKeywords, previewText, rewriteOfferLinks } from './offerMessageText';

describe('extractUrls', () => {
  it('acha links com e sem protocolo, sem pontuação final e sem repetir', () => {
    const t = 'Fone 🔥 https://amzn.to/3abc). Também amzn.to/3abc e *https://shopee.com.br/x-i.1.2*\nGrupo: chat.whatsapp.com/XYZ!';
    expect(extractUrls(t).map((u) => u.href)).toEqual([
      'https://amzn.to/3abc',
      'https://shopee.com.br/x-i.1.2',
      'https://chat.whatsapp.com/XYZ',
    ]);
  });

  it('não confunde preço, peso ou "c/2" com link', () => {
    expect(extractUrls('Por R$ 99.90 à vista, 1.5kg/un, kit c/2')).toEqual([]);
  });

  it('link em itálico/negrito do WhatsApp sem protocolo', () => {
    expect(extractUrls('Oferta _amzn.to/abc_ e *bit.ly/x*').map((u) => u.href)).toEqual(['https://amzn.to/abc', 'https://bit.ly/x']);
  });

  it('pega subdomínio inteiro e encurtador de terceiro sem protocolo', () => {
    expect(extractUrls('www.amazon.com.br/dp/B0ABCDEFGH e bit.ly/xyz e produto.mercadolivre.com.br/MLB-1').map((u) => u.href)).toEqual([
      'https://www.amazon.com.br/dp/B0ABCDEFGH', 'https://bit.ly/xyz', 'https://produto.mercadolivre.com.br/MLB-1',
    ]);
  });
});

describe('rewriteOfferLinks', () => {
  it('troca o link do produto e remove a linha do convite do concorrente', () => {
    const text = '🔥 Fone JBL\nhttps://amzn.to/3abc\n\n👉 Entre no grupo: https://chat.whatsapp.com/XYZ\nCupom: PROMO10';
    const out = rewriteOfferLinks(text, new Map([
      ['https://amzn.to/3abc', 'https://www.amazon.com.br/dp/B0ABCDEFGH?tag=meu-20'],
      ['https://chat.whatsapp.com/XYZ', null],
    ]));
    expect(out).toBe('🔥 Fone JBL\nhttps://www.amazon.com.br/dp/B0ABCDEFGH?tag=meu-20\n\nCupom: PROMO10');
  });

  it('link no meio da frase mantém o texto e a pontuação', () => {
    const out = rewriteOfferLinks('Compre aqui: amzn.to/a!', new Map([['https://amzn.to/a', 'https://x.co/1']]));
    expect(out).toBe('Compre aqui: https://x.co/1!');
  });

  it('mesmo link com e sem protocolo: troca as duas ocorrências', () => {
    const out = rewriteOfferLinks('https://amzn.to/a\nou amzn.to/a', new Map([['https://amzn.to/a', 'L']]));
    expect(out).toBe('L\nou L');
  });

  it('www. sem protocolo é trocado inteiro (sem sobrar prefixo)', () => {
    const out = rewriteOfferLinks('Veja: www.amazon.com.br/dp/X', new Map([['https://www.amazon.com.br/dp/X', 'https://novo']]));
    expect(out).toBe('Veja: https://novo');
  });

  it('linha com produto e convite: mantém a linha, tira só o convite', () => {
    const out = rewriteOfferLinks('https://amzn.to/a e https://t.me/g', new Map([['https://amzn.to/a', 'L'], ['https://t.me/g', null]]));
    expect(out).toBe('L e');
  });
});

describe('detectCoupon', () => {
  it.each([
    ['Use o cupom: PROMO10 no carrinho', 'PROMO10'],
    ['🎟️ CUPOM *DESCONTO15*', 'DESCONTO15'],
    ['código de desconto - meli20', 'MELI20'],
    ['Cupom aplicado automaticamente', null],
    ['Sem nada aqui', null],
  ])('%s → %s', (text, expected) => {
    expect(detectCoupon(text)).toBe(expected);
  });
});

describe('matchesKeywords', () => {
  it('lista vazia aceita tudo', () => expect(matchesKeywords('qualquer', [])).toBe(true));
  it('ignora acento e caixa', () => expect(matchesKeywords('PROMOÇÃO de Fone', ['promocao'])).toBe(true));
  it('sem nenhuma palavra recusa', () => expect(matchesKeywords('Panela', ['fone', ' tv '])).toBe(false));
});

describe('previewText', () => {
  it('corta sem quebrar emoji', () => {
    expect(previewText('🔥'.repeat(5), 3)).toBe('🔥🔥🔥…');
  });
});
