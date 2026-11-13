import { describe, expect, it } from 'vitest';
import { matchesQuery } from './search';

describe('matchesQuery', () => {
  it('vazio casa tudo', () => expect(matchesQuery('qualquer', '  ')).toBe(true));
  it('ignora acento e caixa', () => expect(matchesQuery('Instalando a extensão no iPhone', 'EXTENSAO')).toBe(true));
  it('exige todos os termos', () => {
    expect(matchesQuery('Credencial da Shopee', 'shopee credencial')).toBe(true);
    expect(matchesQuery('Credencial da Shopee', 'shopee amazon')).toBe(false);
  });
});
