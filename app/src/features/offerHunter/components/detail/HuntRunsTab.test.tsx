import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

const svc = vi.hoisted(() => ({ getRun: vi.fn() }));
vi.mock('@/services/offerHunter.service', () => ({ offerHunterService: svc }));

import { useRunRankings, type HuntPagedList } from '../../hooks';
import type { HuntRun } from '../../types';
import { HuntRunsTab } from './HuntRunsTab';
import { RunResultPanel } from '../RunResultPanel';

const run = (id: string, over: Partial<HuntRun> = {}): HuntRun => ({
  id, provider: 'SHEIN', huntId: 'h1', trigger: 'SCHEDULED', status: 'SUCCEEDED', errorCode: null, seenCount: 25, matchedCount: 0, chosenCount: 0,
  sentCount: 0, aiUsed: false, aiFallback: false, rejectedBy: null, hasRanking: false,
  startedAt: '2026-11-12T10:00:00.000Z', finishedAt: '2026-11-12T10:00:05.000Z', ...over,
});
const list = (items: HuntRun[]): HuntPagedList<HuntRun> => ({
  items, loading: false, loadingMore: false, hasMore: false, errorCode: null, loadMore: vi.fn(), reload: vi.fn(), replaceItem: vi.fn(),
} as unknown as HuntPagedList<HuntRun>);
const rankItem = {
  provider: 'SHEIN' as const, productId: 'g1', commissionEstimated: false, goodsId: 'g1', title: 'Vestido', imageUrl: null, priceCents: 4990, discountPercent: 10, commissionPercent: 20, commissionCents: 998,
  returningCommissionPercent: 4.9, returningCommissionCents: 245, extraCommissionCents: 0, salesBucket: 100, reviewsBucket: 50,
  rating: 4.5, score: 70, factors: [], aiReason: 'Boa comissão', chosen: true,
};

/** Aba com o hook real de ranking (service mockado), como a página monta. */
function Tab({ items, openRunId, onToggleRun = vi.fn() }: { items: HuntRun[]; openRunId: string | null; onToggleRun?: (id: string) => void }) {
  const rankings = useRunRankings('h1');
  return <HuntRunsTab runs={list(items)} openRunId={openRunId} onToggleRun={onToggleRun} rankings={rankings} />;
}

beforeEach(() => { svc.getRun.mockReset(); });

describe('HuntRunsTab', () => {
  it('0 no filtro: recusas do maior para o menor e dica; execução antiga sem nada novo', () => {
    render(<Tab items={[run('r1', { rejectedBy: { minRating: 3, minSales: 21, minReviews: 14 } }), run('r2')]} openRunId={null} />);
    expect(screen.getByText('0 no filtro: 21 por vendas, 14 por avaliações, 3 por nota')).toBeInTheDocument();
    expect(screen.getAllByText('Afrouxe o filtro que mais barrou em Editar → Refino.')).toHaveLength(1);
    expect(screen.getAllByTestId('hunt-rejections')).toHaveLength(1);
  });

  it('ranking busca ao abrir, mostra e guarda em cache; sem ranking avisa sem buscar', async () => {
    svc.getRun.mockResolvedValue(run('r1', { hasRanking: true, ranking: [rankItem] }));
    const onToggle = vi.fn();
    const items = [run('r1', { hasRanking: true }), run('r2')];
    const { rerender } = render(<Tab items={items} openRunId={null} onToggleRun={onToggle} />);
    fireEvent.click(screen.getAllByRole('button', { name: 'Ver ranking' })[0]!);
    expect(onToggle).toHaveBeenCalledWith('r1');
    expect(svc.getRun).not.toHaveBeenCalled();
    rerender(<Tab items={items} openRunId="r1" onToggleRun={onToggle} />);
    expect(screen.getByText('Carregando o ranking…')).toBeInTheDocument();
    expect(await screen.findByText('Vestido')).toBeInTheDocument();
    expect(screen.getByText('Boa comissão')).toBeInTheDocument();
    expect(svc.getRun).toHaveBeenCalledWith('h1', 'r1');
    rerender(<Tab items={items} openRunId="r2" onToggleRun={onToggle} />);
    expect(screen.getByText('Ranking não guardado nesta execução.')).toBeInTheDocument();
    rerender(<Tab items={items} openRunId="r1" onToggleRun={onToggle} />);
    expect(await screen.findByText('Vestido')).toBeInTheDocument();
    expect(svc.getRun).toHaveBeenCalledTimes(1);
  });

  it('erro ao buscar o ranking oferece nova tentativa', async () => {
    svc.getRun.mockRejectedValueOnce(Object.assign(new Error('x'), { code: 'INTERNAL' }))
      .mockResolvedValueOnce(run('r1', { hasRanking: true, ranking: [rankItem] }));
    render(<Tab items={[run('r1', { hasRanking: true })]} openRunId="r1" />);
    expect(await screen.findByText('Não conseguimos carregar o ranking desta execução.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }));
    expect(await screen.findByText('Vestido')).toBeInTheDocument();
    expect(svc.getRun).toHaveBeenCalledTimes(2);
  });

  it('execução em andamento: sem "Ver ranking", mostra "Em andamento"', () => {
    render(<Tab items={[run('r1', { status: 'RUNNING', finishedAt: null })]} openRunId="r1" />);
    expect(screen.queryByRole('button', { name: 'Ver ranking' })).not.toBeInTheDocument();
    expect(screen.queryByText('Ranking não guardado nesta execução.')).not.toBeInTheDocument();
    expect(screen.getByTestId('hunt-run-running')).toHaveTextContent('Em andamento');
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
