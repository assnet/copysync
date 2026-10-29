import { describe, expect, it } from 'vitest';
import { canonicalMercadoLivreProductUrl, isMercadoLivreChallengeUrl } from './mercadoLivreProductUrl';

const canon = (u: string) => canonicalMercadoLivreProductUrl(new URL(u))?.toString() ?? null;

describe('canonicalMercadoLivreProductUrl', () => {
  it('catálogo com slug e query de carrinho vira /p/MLB… limpo', () => {
    expect(
      canon('https://www.mercadolivre.com.br/cadeira-de-escritorio/p/MLB43901062?product_trigger_id=MLB43901063&pdp_filters=item_id%3AMLB6889253880&picker=true&sid=cart&quantity=1#reviews'),
    ).toBe('https://www.mercadolivre.com.br/p/MLB43901062');
    expect(canon('https://mercadolivre.com.br/p/mlb123')).toBe('https://www.mercadolivre.com.br/p/MLB123');
  });

  it('item MLB-… perde só query e fragment', () => {
    expect(canon('https://produto.mercadolivre.com.br/MLB-6889253880-cadeira-_JM?matt_word=x#a')).toBe(
      'https://produto.mercadolivre.com.br/MLB-6889253880-cadeira-_JM',
    );
  });

  it.each([
    'https://www.mercadolivre.com.br/social/etiqueta?ref=1',
    'https://www.mercadolivre.com.br/up/MLBU123',
    'https://www.mercadolivre.com.br/ofertas',
    'https://www.amazon.com.br/p/MLB123',
  ])('%s fica como veio (null)', (u) => expect(canon(u)).toBeNull());
});

describe('isMercadoLivreChallengeUrl', () => {
  it.each([
    'https://www.mercadolivre.com.br/gz/account-verification?go=https%3A%2F%2Fwww.mercadolivre.com.br%2Fp%2FMLB1&tid=x',
    'https://www.mercadolivre.com.br/gz/webdevice/config?go=x',
    'https://www.mercadolivre.com.br/captcha/x',
  ])('%s é verificação', (u) => expect(isMercadoLivreChallengeUrl(new URL(u))).toBe(true));
  it.each(['https://www.mercadolivre.com.br/p/MLB1', 'https://www.mercadolivre.com.br/login?go=1', 'https://www.amazon.com.br/gz/x'])(
    '%s não é verificação',
    (u) => expect(isMercadoLivreChallengeUrl(new URL(u))).toBe(false),
  );
});
