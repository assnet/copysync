import { describe, it, expect } from 'vitest';
import { shouldKeepPastedLink } from './shouldKeepPastedLink';

const ML_FINAL = (tag: string) => `https://produto.mercadolivre.com.br/MLB-1-x?matt_word=${tag}`;
const SHEIN_FINAL = (id: string) => `https://br.shein.com/x-p-123.html?url_from=affiliate_koc_${id}`;

describe('shouldKeepPastedLink', () => {
  it.each([
    ['ML curto do tenant', 'MERCADO_LIVRE', 'https://meli.la/abc', ML_FINAL('etq'), 'etq', true],
    ['ML curto mercadolivre.com/social', 'MERCADO_LIVRE', 'https://mercadolivre.com/social/etq', ML_FINAL('etq'), 'etq', true],
    ['ML longo do tenant', 'MERCADO_LIVRE', 'https://www.mercadolivre.com.br/social/etq?matt_word=etq', 'https://www.mercadolivre.com.br/social/etq?matt_word=etq', 'etq', false],
    ['ML curto de outro', 'MERCADO_LIVRE', 'https://meli.la/abc', ML_FINAL('outra'), 'etq', false],
    ['ML curto sem identificador', 'MERCADO_LIVRE', 'https://meli.la/abc', 'https://produto.mercadolivre.com.br/MLB-1-x', 'etq', false],
    ['ML curto sem credencial', 'MERCADO_LIVRE', 'https://meli.la/abc', ML_FINAL('etq'), null, false],
    ['ML divergente', 'MERCADO_LIVRE', 'https://meli.la/abc', `${ML_FINAL('etq')}&matt_word=outra`, 'etq', false],
    ['ML vinculada não principal', 'MERCADO_LIVRE', 'https://meli.la/abc', ML_FINAL('etq2'), ['etq', 'etq2'], true],
    ['ML fora do conjunto', 'MERCADO_LIVRE', 'https://meli.la/abc', ML_FINAL('etq3'), ['etq', 'etq2'], false],
    ['Shopee curto', 'SHOPEE', 'https://s.shopee.com.br/x', 'https://shopee.com.br/x-i.1.2', '123', false],
    ['Amazon curto do tenant', 'AMAZON', 'https://amzn.to/x', 'https://www.amazon.com.br/dp/B0ABCDEFGH?tag=loja-20', 'loja-20', false],
    ['Shein onelink do tenant', 'SHEIN', 'https://onelink.shein.com/1/abc', SHEIN_FINAL('123456'), '123456', true],
    ['Shein onelink de outro', 'SHEIN', 'https://onelink.shein.com/1/abc', SHEIN_FINAL('999'), '123456', false],
    ['Shein longo do tenant', 'SHEIN', SHEIN_FINAL('123456'), SHEIN_FINAL('123456'), '123456', false],
  ] as const)('%s → %s', (_label, provider, source, final, cred, expected) => {
    expect(shouldKeepPastedLink(provider, new URL(source), new URL(final), cred)).toBe(expected);
  });
});
