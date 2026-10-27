import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { SendQueueItem, SendQueueResponse } from '@/types/api.types';

const get = vi.fn<(sessionId?: string) => Promise<SendQueueResponse>>();
vi.mock('@/services/sendQueue.service', () => ({ sendQueueService: { get: (id?: string) => get(id) } }));

import { SendQueuePanel } from './SendQueuePanel';

const soon = new Date(Date.now() + 120_000).toISOString();
const item = (o: Partial<SendQueueItem>): SendQueueItem => ({
  dispatchId: 'd', offerId: 'o1', origin: 'GENERATOR', offerStatus: 'SENDING', title: 'Fone', textPreview: 'Fone',
  imageUrl: null, coupon: null, conversationId: 'c', groupName: 'Promo 1', groupAvatarUrl: null, status: 'QUEUED',
  notBefore: soon, claimedAt: null, updatedAt: soon, failureReason: null, ...o,
});

beforeEach(() => { get.mockReset(); });

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
