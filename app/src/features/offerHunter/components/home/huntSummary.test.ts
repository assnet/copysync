import { describe, expect, it } from 'vitest';
import { hunt, huntOptions } from '../../test/fixtures';
import { huntSummaryChips } from './huntSummary';

// Intl usa espaço não separável em "R$ 10,00"
const norm = (s: string) => s.replace(/\s/g, ' ');
const labels = (h: ReturnType<typeof hunt>) => huntSummaryChips(h, huntOptions()).map((c) => norm(c.label));

describe('huntSummaryChips', () => {
  it('sem filtros: só a predefinição', () => {
    expect(labels(hunt())).toEqual(['Personalizada']);
  });

  it('mostra todo filtro ligado, cada um com Tooltip', () => {
    const h = hunt({
      categoryId: 'c1', keyword: 'vestido',
      filters: {
        minPriceCents: 1000, maxPriceCents: 5000, minDiscountPct: 30, minCommissionPct: 15, commissionOperator: 'GT',
        minCommissionCents: 500, minRating: 4.5, minSales: 1000, minReviews: 500, onlyWithExtra: true, endsWithinDays: 3,
      },
    });
    const chips = huntSummaryChips(h, huntOptions());
    expect(chips.map((c) => c.key)).toEqual([
      'preset', 'category', 'price', 'discount', 'commission', 'commissionValue', 'rating', 'sales', 'reviews',
      'onlyWithExtra', 'endsWithin', 'keyword',
    ]);
    expect(chips.map((c) => norm(c.label))).toEqual([
      'Personalizada', 'Vestidos', 'R$ 10,00 a R$ 50,00', 'Desconto ≥ 30%', 'Comissão 1ª compra > 15%',
      'Comissão 1ª compra ≥ R$ 5,00', 'Nota ≥ 4,5', 'Vendas ≥ 1.000', 'Avaliações ≥ 500', 'Só com extra',
      'Termina em até 3 dias', '"vestido"',
    ].map(norm));
    for (const c of chips) expect(c.tooltip).toBeTruthy();
    expect(chips.find((c) => c.key === 'commission')!.tooltip).toBe('Comissão de 1ª compra maior que 15%.');
  });

  it('faixa antiga gravada não vira chip nem atrapalha a predefinição; operador ausente = ≥', () => {
    const h = hunt({ commissionBand: 'ABOVE_15', filters: { ...hunt().filters, minCommissionPct: 15, commissionOperator: 'GTE' } });
    expect(labels(h)).toEqual(['Maior comissão', 'Comissão 1ª compra ≥ 15%']);
    expect(labels(hunt({ filters: { ...hunt().filters, minCommissionPct: 15 } }))).toContain('Comissão 1ª compra ≥ 15%');
  });
});
