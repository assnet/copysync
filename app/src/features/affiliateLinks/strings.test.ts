import { describe, expect, it } from 'vitest';
import { isAffiliateProvider } from './strings';

describe('isAffiliateProvider', () => {
  it('aceita as lojas do mapa', () => {
    for (const p of ['SHOPEE', 'MERCADO_LIVRE', 'AMAZON', 'SHEIN']) expect(isAffiliateProvider(p)).toBe(true);
  });

  it('recusa chave herdada, desconhecida e não-string', () => {
    for (const v of ['toString', '__proto__', 'constructor', 'hasOwnProperty', 'ALIEXPRESS', '', 1, null, undefined]) {
      expect(isAffiliateProvider(v)).toBe(false);
    }
  });
});
