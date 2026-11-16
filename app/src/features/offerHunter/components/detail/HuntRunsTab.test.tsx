import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const svc = vi.hoisted(() => ({ getRun: vi.fn(), sendRankingItem: vi.fn(), sendAllRanking: vi.fn() }));
vi.mock('@/services/offerHunter.service', () => ({ offerHunterService: svc }));
const auth = vi.hoisted(() => ({ user: { id: 'u1', isSuperAdmin: false } }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: auth.user }) }));

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
function Tab({ items, openRunId, onToggleRun = vi.fn(), onRankingSent }: {
  items: HuntRun[]; openRunId: string | null; onToggleRun?: (id: string) => void; onRankingSent?: () => void;
}) {
  const rankings = useRunRankings('h1');
  return (
    <HuntRunsTab runs={list(items)} openRunId={openRunId} onToggleRun={onToggleRun} rankings={rankings} destinationGroupName="Promo VIP" onRankingSent={onRankingSent} />
  );
}

beforeEach(() => {
  svc.getRun.mockReset();
  svc.sendRankingItem.mockReset();
  svc.sendAllRanking.mockReset();
  auth.user = { id: 'u1', isSuperAdmin: false };
});

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

const item2 = { ...rankItem, productId: 'g2', goodsId: 'g2', title: 'Saia', chosen: false, aiReason: null };
const item3 = { ...rankItem, productId: 'g3', goodsId: 'g3', title: 'Blusa', chosen: false, aiReason: null };
const ranked = (over: Partial<HuntRun> = {}) =>
  run('r1', { hasRanking: true, ranking: [rankItem, item2, item3], sentProductIds: ['g1'], rankingReusable: true, ...over });
/** Rótulo pela posição no ranking (título fora do leitor de tela): Vestido 1º, Saia 2º, Blusa 3º. */
const sendBtn = (pos: string) => screen.getByRole('button', { name: `Enviar a oferta ${pos} do ranking` });
const confirmSend = () => fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Enviar' }));

describe('HuntRunsTab — reaproveitar o ranking', () => {
  it('"Enviar" só nos não escolhidos; confirma citando o grupo, envia e marca "Enviada"', async () => {
    svc.getRun.mockResolvedValueOnce(ranked()).mockResolvedValue(ranked({ sentProductIds: ['g1', 'g2'] }));
    svc.sendRankingItem.mockResolvedValue({ id: 'f2' });
    const onSent = vi.fn();
    render(<Tab items={[run('r1', { hasRanking: true })]} openRunId="r1" onRankingSent={onSent} />);
    await screen.findByText('Saia');
    expect(screen.queryByRole('button', { name: 'Enviar a oferta 1º do ranking' })).not.toBeInTheDocument();
    expect(screen.getAllByTestId('ranking-item-sent')).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Enviar todas as não escolhidas' })).not.toBeInTheDocument();
    fireEvent.click(sendBtn('2º'));
    expect(svc.sendRankingItem).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toHaveTextContent('"Promo VIP"');
    confirmSend();
    await waitFor(() => expect(screen.getAllByTestId('ranking-item-sent')).toHaveLength(2));
    expect(svc.sendRankingItem).toHaveBeenCalledWith('h1', 'r1', 'g2');
    expect(onSent).toHaveBeenCalled();
    await waitFor(() => expect(svc.getRun).toHaveBeenCalledTimes(2));
    expect(screen.getByText('Oferta enviada: está na fila de envio.')).toBeInTheDocument();
  });

  it.each([
    ['OFFER_HUNT_ALREADY_SENT', 'Esta oferta já foi enviada (por esta execução ou dentro do prazo de repetição da caçada).'],
    ['OFFER_HUNT_RANKING_EXPIRED', 'Ranking com mais de 48 h: rode uma busca nova para preços atuais.'],
    ['OFFER_HUNT_DESTINATION_REQUIRED', 'Escolha o grupo de destino do caçador antes de enviar.'],
    ['AFFILIATE_CREDENTIAL_REQUIRED', 'Conecte a sua conta de afiliado da loja.'],
    ['MARKETPLACE_RISK_NOT_ACCEPTED', 'Aceite o aviso de risco do caçador para continuar.'],
    ['PLAN_FEATURE_UNAVAILABLE', 'O caçador não está liberado no seu plano.'],
    ['QUALQUER', 'Algo deu errado. Tente de novo.'],
  ])('erro %s vira mensagem própria', async (code, msg) => {
    svc.getRun.mockResolvedValue(ranked());
    svc.sendRankingItem.mockRejectedValue(Object.assign(new Error('x'), { code }));
    render(<Tab items={[run('r1', { hasRanking: true })]} openRunId="r1" />);
    await screen.findByText('Saia');
    fireEvent.click(sendBtn('2º'));
    confirmSend();
    expect(await screen.findByRole('alert')).toHaveTextContent(msg);
    expect(screen.getAllByTestId('ranking-item-sent')).toHaveLength(code === 'OFFER_HUNT_ALREADY_SENT' ? 2 : 1);
  });

  it('janela expirada: botões desabilitados', async () => {
    auth.user = { id: 'u1', isSuperAdmin: true };
    svc.getRun.mockResolvedValue(ranked({ rankingReusable: false }));
    render(<Tab items={[run('r1', { hasRanking: true })]} openRunId="r1" />);
    await screen.findByText('Saia');
    expect(sendBtn('2º')).toBeDisabled();
    expect(sendBtn('3º')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Enviar todas as não escolhidas' })).toBeDisabled();
  });

  it('sem envio duplo: durante o envio todos os botões travam e só uma chamada sai', async () => {
    svc.getRun.mockResolvedValue(ranked());
    let resolve!: (v: unknown) => void;
    svc.sendRankingItem.mockReturnValue(new Promise((r) => { resolve = r; }));
    render(<Tab items={[run('r1', { hasRanking: true })]} openRunId="r1" />);
    await screen.findByText('Saia');
    fireEvent.click(sendBtn('2º'));
    confirmSend();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Enviar a oferta 2º do ranking' })).toBeDisabled());
    expect(sendBtn('3º')).toBeDisabled();
    fireEvent.click(sendBtn('2º'));
    expect(svc.sendRankingItem).toHaveBeenCalledTimes(1);
    await act(async () => { resolve({ id: 'f2' }); });
  });

  it('super admin: "Enviar todas" confirma a quantidade, chama a rota e lista as puladas', async () => {
    auth.user = { id: 'u1', isSuperAdmin: true };
    svc.getRun.mockResolvedValue(ranked());
    svc.sendAllRanking.mockResolvedValue({ sent: 1, skipped: [{ productId: 'g3', reason: 'REPEATED' }] });
    render(<Tab items={[run('r1', { hasRanking: true })]} openRunId="r1" />);
    await screen.findByText('Saia');
    fireEvent.click(screen.getByRole('button', { name: 'Enviar todas as não escolhidas' }));
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('Enviar 2 ofertas?');
    expect(dialog).toHaveTextContent('"Promo VIP"');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Enviar todas' }));
    expect(await screen.findByText('1 enviada, 1 pulada')).toBeInTheDocument();
    expect(svc.sendAllRanking).toHaveBeenCalledWith('h1', 'r1');
    const skipped = await screen.findByRole('list', { name: 'Ofertas puladas e o motivo' });
    expect(skipped).toHaveTextContent('Blusa');
    expect(skipped).toHaveTextContent('Já enviada dentro do prazo de repetição da caçada.');
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
