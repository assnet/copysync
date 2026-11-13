import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { PrivacyProvider } from '@/features/privacy';
import type { HuntRankingItem } from '../types';
import { RankingTable } from './RankingTable';

const item = (over: Partial<HuntRankingItem> = {}): HuntRankingItem => ({
  goodsId: 'g1', title: 'Vestido midi', imageUrl: 'https://img.example/1.jpg', priceCents: 4990, discountPercent: 30,
  commissionPercent: 20, commissionCents: 998, returningCommissionPercent: 4.9, returningCommissionCents: 245, extraCommissionCents: 0,
  salesBucket: 1000, reviewsBucket: 500, rating: 4.8, score: 81.25,
  factors: [{ key: 'commission', points: 25, max: 30 }, { key: 'discount', points: 12.5, max: 15 }],
  aiReason: 'Combina com o público', chosen: true, ...over,
});

describe('RankingTable', () => {
  it('lista na ordem com posição, preço, corte e motivo da IA', () => {
    render(<RankingTable items={[item(), item({ goodsId: 'g2', title: 'Saia', chosen: false, aiReason: null, score: 40 })]} />);
    const rows = screen.getAllByTestId('ranking-item');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('1º');
    expect(rows[0]).toHaveTextContent('R$ 49,90');
    expect(rows[0]).toHaveTextContent('Escolhida');
    expect(rows[0]).toHaveTextContent('Combina com o público');
    expect(rows[1]).toHaveTextContent('Fora do corte');
  });

  it('fatores da pontuação aparecem no Tooltip', async () => {
    render(<RankingTable items={[item()]} />);
    fireEvent.mouseOver(screen.getByRole('button', { name: /Pontuação 81,3 de 100/ }));
    expect(await screen.findByText('Como a pontuação foi montada')).toBeInTheDocument();
    expect(screen.getByText('Comissão')).toBeInTheDocument();
    expect(screen.getByText('25 de 30')).toBeInTheDocument();
    expect(screen.getByText('Desconto')).toBeInTheDocument();
  });

  it('título borra com offerHunter.productText', () => {
    localStorage.setItem('privacy.blur', JSON.stringify(['offerHunter.productText']));
    render(<PrivacyProvider><RankingTable items={[item()]} /></PrivacyProvider>);
    expect(screen.getByText('Vestido midi').closest('[data-blurred="true"]')).not.toBeNull();
    localStorage.clear();
  });

  it('sem itens mostra o aviso de filtro vazio', () => {
    render(<RankingTable items={[]} />);
    expect(screen.getByText(/Nenhuma oferta passou nos filtros/)).toBeInTheDocument();
  });
});
