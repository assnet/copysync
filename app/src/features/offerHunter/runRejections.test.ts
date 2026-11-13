import { describe, expect, it } from 'vitest';
import { rejectionParts, rejectionSummary } from './runRejections';

describe('runRejections', () => {
  it('ordena do maior para o menor e ignora zero/chave desconhecida', () => {
    expect(rejectionParts({ minRating: 3, minSales: 21, minReviews: 14, minPriceCents: 0, x: 9 } as never).map((p) => p.key))
      .toEqual(['minSales', 'minReviews', 'minRating']);
  });

  it('0 no filtro: linha com nomes e dica', () => {
    expect(rejectionSummary({ minRating: 3, minSales: 21, minReviews: 14 }, 0)).toEqual({
      line: '0 no filtro: 21 por vendas, 14 por avaliações, 3 por nota', hint: true,
    });
  });

  it('comissão de 1ª compra no texto; só repetição não pede para afrouxar', () => {
    expect(rejectionSummary({ minCommissionPct: 2 }, 1)!.line).toBe('1 no filtro: 2 por comissão de 1ª compra');
    expect(rejectionSummary({ repeated: 4 }, 0)).toEqual({ line: '0 no filtro: 4 por repetição', hint: false });
  });

  it('execução antiga (null) ou nada barrado → nada novo', () => {
    expect(rejectionSummary(null, 0)).toBeNull();
    expect(rejectionSummary(undefined, 0)).toBeNull();
    expect(rejectionSummary({}, 5)).toBeNull();
  });
});
