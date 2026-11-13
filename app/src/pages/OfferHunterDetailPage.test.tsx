import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { hunt, huntFind, huntOptions } from '@/features/offerHunter/test/fixtures';

const svc = vi.hoisted(() => ({
  get: vi.fn(), getOptions: vi.fn(), listFinds: vi.fn(), listRuns: vi.fn(), approveFind: vi.fn(), dismissFind: vi.fn(),
  run: vi.fn(), pause: vi.fn(), resume: vi.fn(), list: vi.fn(), getSettings: vi.fn(), resendFind: vi.fn(),
}));
vi.mock('@/services/offerHunter.service', () => ({ offerHunterService: svc }));

import { OfferHunterDetailPage } from './OfferHunterDetailPage';

const renderPage = () => render(
  <MemoryRouter initialEntries={['/offer-hunter/h1']}>
    <Routes><Route path="/offer-hunter/:huntId" element={<OfferHunterDetailPage />} /></Routes>
  </MemoryRouter>,
);

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  svc.get.mockResolvedValue(hunt());
  svc.getOptions.mockResolvedValue(huntOptions());
  svc.listFinds.mockResolvedValue({ items: [huntFind('f1'), huntFind('f2', { status: 'FAILED', failureReason: 'SESSION_NOT_CONNECTED' })], nextCursor: 'c2' });
  svc.listRuns.mockResolvedValue({ items: [], nextCursor: null });
  svc.getSettings.mockResolvedValue({ sessionId: 's1', conversationId: 'c1', valid: true, groupName: 'Ofertas VIP' });
});

describe('OfferHunterDetailPage', () => {
  it('aprovar e dispensar pedem confirmação e chamam o hook', async () => {
    svc.approveFind.mockResolvedValue({ find: huntFind('f1', { status: 'APPROVED' }), offerId: 'o1' });
    svc.dismissFind.mockResolvedValue(huntFind('f1', { status: 'DISMISSED' }));
    renderPage();
    const first = (await screen.findAllByTestId('hunt-find'))[0]!;
    expect(within(first).getByText('R$ 19,90')).toBeInTheDocument();

    fireEvent.click(within(first).getByRole('button', { name: 'Aprovar e enviar' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Aprovar e enviar' }));
    await waitFor(() => expect(svc.approveFind).toHaveBeenCalledWith('f1'));
    expect(await within(first).findByText('Aprovado')).toBeInTheDocument();
    expect(svc.dismissFind).not.toHaveBeenCalled();

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    // Achado que falhou: reenviar usa o mesmo caminho do aprovar
    const second = screen.getAllByTestId('hunt-find')[1]!;
    svc.approveFind.mockResolvedValue({ find: huntFind('f2', { status: 'SENT' }), offerId: 'o2' });
    fireEvent.click(within(second).getByRole('button', { name: 'Reenviar' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Reenviar' }));
    await waitFor(() => expect(svc.approveFind).toHaveBeenCalledWith('f2'));
  });

  it('dispensar chama dismiss', async () => {
    svc.dismissFind.mockResolvedValue(huntFind('f1', { status: 'DISMISSED' }));
    renderPage();
    const first = (await screen.findAllByTestId('hunt-find'))[0]!;
    fireEvent.click(within(first).getByRole('button', { name: 'Dispensar' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Dispensar' }));
    await waitFor(() => expect(svc.dismissFind).toHaveBeenCalledWith('f1'));
  });

  it('carregar mais pede a próxima página pelo cursor', async () => {
    renderPage();
    await screen.findAllByTestId('hunt-find');
    svc.listFinds.mockResolvedValueOnce({ items: [huntFind('f3')], nextCursor: null });
    fireEvent.click(screen.getByRole('button', { name: 'Carregar mais' }));
    await waitFor(() => expect(screen.getAllByTestId('hunt-find')).toHaveLength(3));
    expect(svc.listFinds).toHaveBeenLastCalledWith('h1', 'c2');
    expect(screen.queryByRole('button', { name: 'Carregar mais' })).not.toBeInTheDocument();
  });

  it('erro de teto do dia ao rodar mostra a mensagem', async () => {
    svc.run.mockRejectedValue({ code: 'OFFER_HUNT_DAILY_LIMIT', status: 429 });
    renderPage();
    const btn = await screen.findByRole('button', { name: 'Rodar agora' });
    await waitFor(() => expect(btn).toBeEnabled());
    fireEvent.click(btn);
    expect(await screen.findByText(/atingiu o limite de ofertas garimpadas hoje/)).toBeInTheDocument();
  });

  it('aba ativa persiste por aba do navegador', async () => {
    const { unmount } = renderPage();
    fireEvent.click(await screen.findByRole('tab', { name: 'Execuções' }));
    expect(await screen.findByText('Nenhuma busca ainda')).toBeInTheDocument();
    unmount();
    renderPage();
    expect(await screen.findByRole('tab', { name: 'Execuções' })).toHaveAttribute('aria-selected', 'true');
  });

  it('reenviar achado entregue: confirma citando o grupo atual, chama a API e mostra "Na fila de envio"', async () => {
    svc.listFinds.mockResolvedValue({ items: [huntFind('f3', { status: 'SENT', offerId: 'o1', dispatchStatus: 'SENT', sentAt: '2026-11-12T15:00:00.000Z' })], nextCursor: null });
    svc.resendFind.mockResolvedValue(huntFind('f3', { status: 'SENT', offerId: 'o2', dispatchStatus: 'QUEUED', resendCount: 1 }));
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Reenviar' }));
    expect(await screen.findByText(/"Ofertas VIP"/)).toBeInTheDocument();
    const buttons = screen.getAllByRole('button', { name: 'Reenviar' });
    fireEvent.click(buttons[buttons.length - 1]!);
    await waitFor(() => expect(svc.resendFind).toHaveBeenCalledWith('f3'));
    expect(await screen.findByText('Na fila de envio')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Reenviar' })).toBeDisabled());
  });
});
