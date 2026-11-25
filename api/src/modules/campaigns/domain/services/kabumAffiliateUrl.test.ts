import { describe, expect, it } from 'vitest';
import { kabumAffiliateUrl, kabumProductUrl } from './kabumAffiliateUrl';
import { detectMarketplace } from './detectMarketplace';
import { parseProductRef } from './parseProductRef';
import { verifyAffiliateLink } from './verifyAffiliateLink';

describe('kabumAffiliateUrl', () => {
  it('sai exatamente no formato Awin com a URL canônica codificada', () => {
    expect(kabumAffiliateUrl('1234567', '112948')).toBe(
      'https://www.awin1.com/cread.php?awinmid=17729&awinaffid=1234567&ued=https%3A%2F%2Fwww.kabum.com.br%2Fproduto%2F112948',
    );
  });

  it('o link gerado é reconhecido como Kabum, do mesmo produto e do tenant', () => {
    const url = new URL(kabumAffiliateUrl('1234567', '112948'));
    expect(detectMarketplace(url)).toBe('KABUM');
    expect(parseProductRef('KABUM', url)).toEqual({ provider: 'KABUM', productId: '112948' });
    expect(verifyAffiliateLink('KABUM', [url], '1234567')).toBe('verified');
  });

  it('URL canônica é a forma curta; id fora do formato lança', () => {
    expect(kabumProductUrl('112948')).toBe('https://www.kabum.com.br/produto/112948');
    expect(() => kabumProductUrl('12a')).toThrow();
  });
});
