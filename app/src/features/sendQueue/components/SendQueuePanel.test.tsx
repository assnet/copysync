import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { SendQueueItem, SendQueueResponse } from '@/types/api.types';

const get = vi.fn<(sessionId?: string) => Promise<SendQueueResponse>>();
vi.mock('@/services/sendQueue.service', () => ({ sendQueueService: { get: (id?: string) => get(id) } }));
const pause = vi.fn(); const resume = vi.fn(); const cancel = vi.fn();
vi.mock('@/services/offer.service', () => ({ offerService: { pause: (id: string) => pause(id), resume: (id: string) => resume(id), cancel: (id: string) => cancel(id) } }));

import { SendQueuePanel } from './SendQueuePanel';

const soon = new Date(Date.now() + 120_000).toISOString();
const item = (o: Partial<SendQueueItem>): SendQueueItem => ({
  dispatchId: 'd', offerId: 'o1', origin: 'GENERATOR', offerStatus: 'SENDING', title: 'Fone', textPreview: 'Fone',
  imageUrl: null, coupon: null, conversationId: 'c', groupName: 'Promo 1', groupAvatarUrl: null, status: 'QUEUED',
  notBefore: soon, claimedAt: null, updatedAt: soon, failureReason: null, waitingSession: false, ...o,
});

beforeEach(() => {
  get.mockReset(); pause.mockReset(); resume.mockReset(); cancel.mockReset();
  // Aba persistida (usePersistedState) não pode vazar de um teste para o outro
  sessionStorage.clear(); localStorage.clear();
});

describe('SendQueuePanel', () => {
  it('fila vazia mostra o estado vazio', async () => {
    get.mockResolvedValue({ serverTime: soon, sessions: [{ sessionId: 's1', name: 'Loja', status: 'CONNECTED', running: null, waiting: [], recent: [], counts: { waiting: 0, paused: 0, sentToday: 0, failedToday: 0, skippedToday: 0 } }] });
    render(<SendQueuePanel />);
    expect(await screen.findByText('Nada na fila agora')).toBeInTheDocument();
  });

  it('mostra sessão, envio em curso, aguardando com origem e abre oferta de outra aba', async () => {
    get.mockResolvedValue({
      serverTime: soon,
      sessions: [{
        sessionId: 's1', name: 'Loja', status: 'CONNECTED',
        running: item({ dispatchId: 'r', status: 'SENDING', groupName: 'Promo 0', claimedAt: soon }),
        waiting: [item({ dispatchId: 'w1', offerId: 'o2' }), item({ dispatchId: 'w2', offerId: 'o3', origin: 'MONITORING', groupName: 'Promo 2' })],
        recent: [],
        counts: { waiting: 2, paused: 0, sentToday: 3, failedToday: 0, skippedToday: 0 },
      }],
    });
    const onOpen = vi.fn();
    render(<SendQueuePanel onOpenOffer={onOpen} currentOfferId="o1" />);
    expect(await screen.findByText('Loja')).toBeInTheDocument();
    expect(screen.getByText('Enviando agora')).toBeInTheDocument();
    expect(screen.getByText('Aguardando (2)')).toBeInTheDocument();
    expect(screen.getByText('3 enviados hoje')).toBeInTheDocument();
    expect(screen.getByText('Monitoramento')).toBeInTheDocument();
    // Só a oferta do gerador que não está aberta ganha "Abrir"
    const open = screen.getAllByRole('button', { name: 'Abrir oferta' });
    expect(open).toHaveLength(1);
    fireEvent.click(open[0]!);
    expect(onOpen).toHaveBeenCalledWith('o2');
  });

  it('sessão desconectada com fila avisa que espera', async () => {
    get.mockResolvedValue({
      serverTime: soon,
      sessions: [{ sessionId: 's1', name: 'Loja', status: 'DISCONNECTED', running: null, waiting: [item({})], recent: [], counts: { waiting: 1, paused: 0, sentToday: 0, failedToday: 0, skippedToday: 0 } }],
    });
    render(<SendQueuePanel />);
    expect(await screen.findByText(/Sessão desconectada/)).toBeInTheDocument();
  });

  it('falha ao carregar oferece tentar de novo', async () => {
    get.mockImplementation(async () => { throw new Error('x'); });
    render(<SendQueuePanel />);
    expect(await screen.findByText('Não foi possível carregar a fila.')).toBeInTheDocument();
  });
});

describe('SendQueuePanel — sessão fora do ar', () => {
  it('envio devolvido por sessão desconectada aparece como "Aguardando a sessão"', async () => {
    get.mockResolvedValue({
      serverTime: soon,
      sessions: [{ sessionId: 's1', name: 'Loja', status: 'CONNECTED', running: null, waiting: [item({ waitingSession: true })], recent: [], counts: { waiting: 1, paused: 0, sentToday: 0, failedToday: 0, skippedToday: 0 } }],
    });
    render(<SendQueuePanel />);
    expect(await screen.findByText('Aguardando a sessão')).toBeInTheDocument();
  });

  const lane = (waiting: SendQueueItem[], running: SendQueueItem | null = null): SendQueueResponse => ({
    serverTime: soon,
    sessions: [{ sessionId: 's1', name: 'Loja', status: 'CONNECTED', running, waiting, recent: [], counts: { waiting: waiting.length, paused: 0, sentToday: 0, failedToday: 0, skippedToday: 0 } }],
  });

  it('pausar e retomar agem na oferta e recarregam a fila (também no monitoramento, sem onOpenOffer)', async () => {
    get.mockResolvedValue(lane([item({ dispatchId: 'w1', offerId: 'o2', origin: 'MONITORING' }), item({ dispatchId: 'w2', offerId: 'o3', offerStatus: 'PAUSED' })]));
    pause.mockResolvedValue({}); resume.mockResolvedValue({});
    render(<SendQueuePanel sessionId="s1" />);
    await screen.findByText('Loja');
    const calls = get.mock.calls.length;
    fireEvent.click(screen.getAllByLabelText('Pausar oferta')[0]);
    await vi.waitFor(() => expect(pause).toHaveBeenCalledWith('o2'));
    await vi.waitFor(() => expect(get.mock.calls.length).toBeGreaterThan(calls));
    fireEvent.click(screen.getByLabelText('Retomar oferta'));
    await vi.waitFor(() => expect(resume).toHaveBeenCalledWith('o3'));
    expect(screen.queryByLabelText('Abrir oferta')).not.toBeInTheDocument();
  });

  it('parar pede confirmação e só então cancela', async () => {
    get.mockResolvedValue(lane([item({ dispatchId: 'w1', offerId: 'o2' })]));
    cancel.mockResolvedValue({});
    render(<SendQueuePanel sessionId="s1" />);
    await screen.findByText('Loja');
    fireEvent.click(screen.getByLabelText('Parar oferta'));
    expect(cancel).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole('button', { name: 'Parar oferta' }));
    await vi.waitFor(() => expect(cancel).toHaveBeenCalledWith('o2'));
  });

  it('409 OFFER_INVALID_STATE não mostra erro; outra falha mostra', async () => {
    get.mockResolvedValue(lane([item({ dispatchId: 'w1', offerId: 'o2' })]));
    pause.mockRejectedValueOnce({ code: 'OFFER_INVALID_STATE' });
    render(<SendQueuePanel sessionId="s1" />);
    await screen.findByText('Loja');
    fireEvent.click(screen.getByLabelText('Pausar oferta'));
    await vi.waitFor(() => expect(pause).toHaveBeenCalled());
    expect(screen.queryByText(/Não foi possível alterar/)).not.toBeInTheDocument();
    await vi.waitFor(() => expect(screen.getByLabelText('Pausar oferta')).not.toBeDisabled());
    pause.mockRejectedValueOnce(new Error('x'));
    fireEvent.click(screen.getByLabelText('Pausar oferta'));
    expect(await screen.findByText(/Não foi possível alterar/)).toBeInTheDocument();
  });

  it('envio concluído não tem controles', async () => {
    get.mockResolvedValue({ ...lane([]), sessions: [{ ...lane([]).sessions[0], recent: [item({ status: 'SENT', offerStatus: 'SENT' })], counts: { waiting: 0, paused: 0, sentToday: 1, failedToday: 0, skippedToday: 0 } }] });
    render(<SendQueuePanel sessionId="s1" />);
    await screen.findByText('Loja');
    fireEvent.click(screen.getByRole('tab', { name: /Concluídos/ }));
    expect(screen.queryByLabelText('Pausar oferta')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Parar oferta')).not.toBeInTheDocument();
  });

  it('oferta com vários grupos: botões só na 1ª linha, com o alcance', async () => {
    get.mockResolvedValue(lane([
      item({ dispatchId: 'w1', offerId: 'o2', groupName: 'G1' }),
      item({ dispatchId: 'w2', offerId: 'o2', groupName: 'G2' }),
      item({ dispatchId: 'w3', offerId: 'o2', groupName: 'G3' }),
    ]));
    render(<SendQueuePanel sessionId="s1" />);
    await screen.findByText('Loja');
    expect(screen.getAllByLabelText('Pausar oferta')).toHaveLength(1);
    expect(screen.getAllByLabelText('Parar oferta')).toHaveLength(1);
    expect(screen.getByText('esta oferta · 3 grupos')).toBeInTheDocument();
  });
});
