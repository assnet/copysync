import { describe, expect, it } from 'vitest';
import { detectStore, linkProblem } from './offerStore';
import { intervalRisk, intervalValid } from './offerConfig';
import { toOfferError } from './offerErrors';

describe('detectStore', () => {
  it('reconhece hosts e subdomínios das lojas', () => {
    expect(detectStore('https://s.shopee.com.br/abc')).toBe('SHOPEE');
    expect(detectStore('https://shope.ee/x')).toBe('SHOPEE');
    expect(detectStore('https://produto.mercadolivre.com.br/MLB-1')).toBe('MERCADO_LIVRE');
    expect(detectStore('https://meli.la/2xyz')).toBe('MERCADO_LIVRE');
    expect(detectStore('https://amzn.to/abc')).toBe('AMAZON');
    expect(detectStore('https://www.amazon.com.br/dp/B0')).toBe('AMAZON');
  });

  it('não confunde host parecido', () => {
    expect(detectStore('https://fakeshopee.com.br/x')).toBeNull();
    expect(detectStore('https://amazon.com.br.evil.io/x')).toBeNull();
    expect(detectStore('não é link')).toBeNull();
  });
});

describe('linkProblem', () => {
  it('classifica o link', () => {
    expect(linkProblem('')).toBe('required');
    expect(linkProblem('http://shopee.com.br/x')).toBe('invalid');
    expect(linkProblem('https://example.com')).toBe('unknownStore');
    expect(linkProblem('https://meli.la/abc')).toBeNull();
  });
});

describe('intervalValid', () => {
  it('respeita 60 ≤ min ≤ max ≤ 3600 (1–60 min)', () => {
    expect(intervalValid(120, 300)).toBe(true);
    expect(intervalValid(59, 300)).toBe(false);
    expect(intervalValid(1200, 600)).toBe(false);
    expect(intervalValid(600, 3601)).toBe(false);
  });

  it('termômetro: média perto de 1 min = alto risco; média ≥ 10 min = seguro; curva monotônica', () => {
    expect(intervalRisk(60, 60)).toMatchObject({ score: 0, level: 'high' });
    expect(intervalRisk(600, 600).level).toBe('safe');
    expect(intervalRisk(3000, 3600)).toMatchObject({ score: 1, level: 'safe' });
    expect(intervalRisk(120, 300).level).toBe('moderate');
    const scores = [[60, 120], [120, 300], [300, 600], [600, 900]].map(([a, b]) => intervalRisk(a!, b!).score);
    expect([...scores].sort((x, y) => x - y)).toEqual(scores);
  });
});

describe('toOfferError v2', () => {
  it('link de outro afiliado é erro do campo', () => {
    const view = toOfferError({ code: 'OFFER_LINK_NOT_OWNED' });
    expect(view.isLinkField).toBe(true);
    expect(view.message).toContain('outro afiliado');
  });

  it('limite de grupos usa a chave broadcast_groups', () => {
    expect(toOfferError({ code: 'PLAN_LIMIT_REACHED', meta: { key: 'broadcast_groups', limit: 5 } }).message).toContain('5 grupos');
  });

  it('configuração ausente leva à configuração', () => {
    expect(toOfferError({ code: 'OFFER_CONFIG_MISSING' }).action).toBe('config');
    expect(toOfferError({ code: 'SESSION_NOT_CONNECTED' }).action).toBe('sessions');
  });
});
