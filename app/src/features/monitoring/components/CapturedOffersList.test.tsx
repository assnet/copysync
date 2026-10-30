import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { CapturedOfferItem } from '@/types/api.types';

const listCaptured = vi.fn();
vi.mock('@/services/monitoring.service', () => ({
  monitoringService: { listCaptured: (id: string, c?: string) => listCaptured(id, c), retryCaptured: vi.fn() },
}));

import { CapturedOffersList } from './CapturedOffersList';

const item = (id: string, text: string, over: Partial<CapturedOfferItem> = {}): CapturedOfferItem => ({
  id, status: 'QUEUED', reason: null, marketplace: 'SHOPEE', sourceGroupTitle: 'Promo Rival', sourceGroupAvatarUrl: null, textPreview: text,
  imageUrl: null, coupon: null, affiliateUrl: null, offerId: null, textSource: null, aiErrorCode: null, offerStatus: null,
  sentCount: 0, totalCount: 0, capturedAt: new Date().toISOString(), expiresAt: null, startsAt: null, imageUnavailable: false, ...over,
});

const items = [
  item('a', 'Oferta sem credencial', { status: 'SKIPPED', reason: 'CREDENTIAL_MISSING' }),
  item('b', 'Oferta sem link', { status: 'SKIPPED', reason: 'NO_LINK' }),
  item('c', 'Oferta na fila'),
];

beforeEach(() => {
  sessionStorage.clear();
  listCaptured.mockReset();
  listCaptured.mockResolvedValue({ items, nextCursor: null });
});

const list = () => screen.getByRole('list', { name: 'Ofertas capturadas' });

describe('CapturedOffersList', () => {
  it('"Precisam de ação" mostra só as recuperáveis', async () => {
    render(<CapturedOffersList sessionId="s1" />);
    await screen.findByText('Oferta na fila');
    fireEvent.click(screen.getByRole('button', { name: 'Precisam de ação: 1 oferta' }));
    expect(within(list()).getByText('Oferta sem credencial')).toBeInTheDocument();
    expect(within(list()).queryByText('Oferta sem link')).not.toBeInTheDocument();
    expect(within(list()).queryByText('Oferta na fila')).not.toBeInTheDocument();
  });

  it('o filtro persiste por sessão na aba', async () => {
    const { unmount } = render(<CapturedOffersList sessionId="s1" />);
    await screen.findByText('Oferta na fila');
    fireEvent.click(screen.getByRole('button', { name: 'Na fila: 1 oferta' }));
    unmount();

    const again = render(<CapturedOffersList sessionId="s1" />);
    await screen.findByText('Oferta na fila');
    expect(screen.getByRole('button', { name: 'Na fila: 1 oferta' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByText('Oferta sem link')).not.toBeInTheDocument();
    again.unmount();

    render(<CapturedOffersList sessionId="s2" />);
    await screen.findByText('Oferta na fila');
    expect(screen.getByRole('button', { name: 'Todas: 3 ofertas' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('linha sem imagem não mostra "Imagem indisponível"; só quando a imagem falhou', async () => {
    listCaptured.mockResolvedValue({ items: [items[2]], nextCursor: null });
    const { unmount } = render(<CapturedOffersList sessionId="s1" />);
    await screen.findByText('Oferta na fila');
    expect(screen.queryByText('Imagem indisponível')).not.toBeInTheDocument();
    unmount();

    listCaptured.mockResolvedValue({ items: [{ ...items[2], imageUnavailable: true }], nextCursor: null });
    render(<CapturedOffersList sessionId="s1" />);
    expect(await screen.findByText('Imagem indisponível')).toBeInTheDocument();
  });

  it('mostra quando foi atualizado', async () => {
    render(<CapturedOffersList sessionId="s1" />);
    expect(await screen.findByText(/^Atualizado às \d{2}:\d{2}$/)).toBeInTheDocument();
  });

  it('selo segue os filtros: recuperável = "Precisa de ação"; sem volta = "Ignorada"', async () => {
    listCaptured.mockResolvedValue({ items: [...items, item('d', 'Oferta com erro', { status: 'FAILED', reason: null })], nextCursor: null });
    render(<CapturedOffersList sessionId="s1" />);
    await screen.findByText('Oferta na fila');
    expect(within(list()).getAllByText('Precisa de ação')).toHaveLength(1);
    expect(within(list()).getAllByText('Ignorada')).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Ignoradas: 2 ofertas' })).toBeInTheDocument();
  });

  it('com mais páginas, contagens ficam parciais ("3+", "nas carregadas")', async () => {
    listCaptured.mockResolvedValue({ items, nextCursor: 'c1' });
    render(<CapturedOffersList sessionId="s1" />);
    await screen.findByText('Oferta na fila');
    const all = screen.getByRole('button', { name: 'Todas: 3 ofertas nas carregadas' });
    expect(within(all).getByText('3+')).toBeInTheDocument();
  });
});
