import { describe, expect, it } from 'vitest';
import { findForeignMarketplaceLinks } from './findForeignMarketplaceLinks';

const AFF = 'https://amzn.to/meu123';
const STORED = `🔥 Fone\n🛒 ${AFF}`;
const hrefs = (newText: string, stored: string | null = STORED, aff: string | null = AFF) =>
  findForeignMarketplaceLinks(newText, stored, aff).map((u) => u.href);

describe('findForeignMarketplaceLinks', () => {
  it('texto sem link novo → vazio', () => {
    expect(hrefs(`🔥 Fone com desconto\n🛒 ${AFF}`)).toEqual([]);
  });

  it('link de marketplace acrescentado → aponta o link', () => {
    expect(hrefs(`${STORED}\nOutra: https://meli.la/alheio`)).toEqual(['https://meli.la/alheio']);
  });

  it('acrescentado com http:// e sem protocolo também conta', () => {
    expect(hrefs(`${STORED}\nhttp://s.shopee.com.br/x`)).toEqual(['http://s.shopee.com.br/x']);
    expect(hrefs(`${STORED}\namzn.to/outro`)).toEqual(['https://amzn.to/outro']);
  });

  it('affiliateUrl fora do texto gravado não conta (comparação por href, com ou sem protocolo)', () => {
    expect(hrefs(`Compre: ${AFF}`, 'texto sem link')).toEqual([]);
    expect(hrefs('Compre: amzn.to/meu123', 'texto sem link')).toEqual([]);
  });

  it('links que já estavam no texto gravado ficam, mesmo sem ser o affiliateUrl', () => {
    const stored = `Oferta\nhttps://meli.la/a\nhttps://meli.la/b\nhttps://amzn.to/c`;
    expect(hrefs(`Oferta editada\nhttps://meli.la/a\nmeli.la/b\nhttps://amzn.to/c.`, stored, 'https://meli.la/a')).toEqual([]);
  });

  it('convite de grupo e outros hosts passam', () => {
    expect(hrefs(`${STORED}\nGrupo: https://chat.whatsapp.com/abc\nbit.ly/xyz\nhttps://example.com/p`)).toEqual([]);
  });

  it('host parecido com marketplace não conta (sufixo exato)', () => {
    expect(hrefs(`${STORED}\nhttps://evilshopee.com.br/x`)).toEqual([]);
  });

  it('sem texto gravado nem affiliateUrl: todo link de marketplace conta', () => {
    expect(hrefs('https://meli.la/a e https://www.amazon.com.br/dp/B0X', null, null))
      .toEqual(['https://meli.la/a', 'https://www.amazon.com.br/dp/B0X']);
  });
});
