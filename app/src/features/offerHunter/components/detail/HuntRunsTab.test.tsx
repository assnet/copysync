import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { HuntPagedList } from '../../hooks';
import type { HuntRun } from '../../types';
import { HuntRunsTab } from './HuntRunsTab';
import { RunResultPanel } from '../RunResultPanel';

const run = (id: string, over: Partial<HuntRun> = {}): HuntRun => ({
  id, huntId: 'h1', trigger: 'SCHEDULED', status: 'SUCCEEDED', errorCode: null, seenCount: 25, matchedCount: 0, chosenCount: 0,
  sentCount: 0, aiUsed: false, aiFallback: false, rejectedBy: null, ranking: null,
  startedAt: '2026-11-12T10:00:00.000Z', finishedAt: '2026-11-12T10:00:05.000Z', ...over,
});
const list = (items: HuntRun[]): HuntPagedList<HuntRun> => ({
  items, loading: false, loadingMore: false, hasMore: false, errorCode: null, loadMore: vi.fn(), reload: vi.fn(), replaceItem: vi.fn(),
} as unknown as HuntPagedList<HuntRun>);
const rankItem = {
  goodsId: 'g1', title: 'Vestido', imageUrl: null, priceCents: 4990, discountPercent: 10, commissionPercent: 20, commissionCents: 998,
  returningCommissionPercent: 4.9, returningCommissionCents: 245, extraCommissionCents: 0, salesBucket: 100, reviewsBucket: 50,
  rating: 4.5, score: 70, factors: [], aiReason: 'Boa comissão', chosen: true,
};

describe('HuntRunsTab', () => {
  it('0 no filtro: recusas do maior para o menor e dica; execução antiga sem nada novo', () => {
    render(<HuntRunsTab runs={list([
      run('r1', { rejectedBy: { minRating: 3, minSales: 21, minReviews: 14 } }),
      run('r2'),
    ])} openRunId={null} onToggleRun={vi.fn()} />);
    expect(screen.getByText('0 no filtro: 21 por vendas, 14 por avaliações, 3 por nota')).toBeInTheDocument();
    expect(screen.getAllByText('Afrouxe o filtro que mais barrou em Editar → Refino.')).toHaveLength(1);
    expect(screen.getAllByTestId('hunt-rejections')).toHaveLength(1);
  });

  it('ranking guardado abre na execução; antiga avisa que não foi guardado', () => {
    const onToggle = vi.fn();
    const { rerender } = render(<HuntRunsTab runs={list([run('r1', { ranking: [rankItem] }), run('r2')])} openRunId={null} onToggleRun={onToggle} />);
    fireEvent.click(screen.getAllByRole('button', { name: 'Ver ranking' })[0]!);
    expect(onToggle).toHaveBeenCalledWith('r1');
    rerender(<HuntRunsTab runs={list([run('r1', { ranking: [rankItem] }), run('r2')])} openRunId="r1" onToggleRun={onToggle} />);
    expect(screen.getByText('Vestido')).toBeInTheDocument();
    expect(screen.getByText('Boa comissão')).toBeInTheDocument();
    rerender(<HuntRunsTab runs={list([run('r1', { ranking: [rankItem] }), run('r2')])} openRunId="r2" onToggleRun={onToggle} />);
    expect(screen.getByText('Ranking não guardado nesta execução.')).toBeInTheDocument();
  });
});

describe('RunResultPanel', () => {
  it('mostra por que 0 no filtro no resultado de "Rodar agora"', () => {
    render(<RunResultPanel title="Resultado" running={false} error={null} result={{
      runId: 'r1', status: 'SUCCEEDED', errorCode: null, seenCount: 25, matchedCount: 0, chosenCount: 0, sentCount: 0,
      aiUsed: false, aiFallback: false, rejectedBy: { minCommissionPct: 25, repeated: 2 }, ranking: [], finds: [], remainingToday: 10, pausedReason: null,
    }} />);
    expect(screen.getByText('0 no filtro: 25 por comissão de 1ª compra, 2 por repetição')).toBeInTheDocument();
  });
});
