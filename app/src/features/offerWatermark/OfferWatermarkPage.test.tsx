import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ThemeProvider } from '@mui/material';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { buildTheme } from '@/theme/theme';
import { OfferWatermarkPage } from './OfferWatermarkPage';
import type { OfferWatermark } from './types';

const svc = vi.hoisted(() => ({ get: vi.fn(), update: vi.fn(), setImage: vi.fn(), removeImage: vi.fn(), getAccess: vi.fn() }));
vi.mock('./offerWatermark.service', () => ({ offerWatermarkService: svc }));
vi.mock('@/contexts/TenantContext', () => ({ useTenant: () => ({ activeTenantId: 't1' }) }));

const base: OfferWatermark = {
  enabled: false, kind: 'IMAGE', text: null, position: 'BOTTOM_RIGHT', size: 'MEDIUM', opacity: 80,
  imageUrl: null, canEdit: true, updatedAt: null,
};
const DRAFT_KEY = 'ui.offerWatermark.draft.t1';

const renderPage = (mode: 'light' | 'dark' = 'light') => render(
  <ThemeProvider theme={buildTheme(mode)}>
    <MemoryRouter initialEntries={['/offer-watermark']}>
      <Routes>
        <Route path="/offer-watermark" element={<OfferWatermarkPage />} />
        <Route path="/dashboard" element={<p>dashboard</p>} />
      </Routes>
    </MemoryRouter>
  </ThemeProvider>,
);

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  localStorage.clear();
});

describe('OfferWatermarkPage', () => {
  it.each(['light', 'dark'] as const)('%s: tipo exclusivo Logo | Texto; o outro dado não some', async (mode) => {
    svc.get.mockResolvedValue({ ...base, text: 'Achados' });
    renderPage(mode);
    const logo = await screen.findByRole('button', { name: /Logo/ });
    expect(logo).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Enviar logo' })).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: /Texto da marca/ })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Texto/ }));
    expect(screen.getByRole('button', { name: /Texto/ })).toHaveAttribute('aria-pressed', 'true');
    expect(logo).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('textbox', { name: /Texto da marca/ })).toHaveValue('Achados');
    expect(screen.queryByRole('button', { name: 'Enviar logo' })).not.toBeInTheDocument();
  });

  it('texto: vazio e acima de 32 bloqueiam o salvar com a mensagem no campo; contador', async () => {
    svc.get.mockResolvedValue({ ...base, kind: 'TEXT', text: 'Achados' });
    renderPage();
    const field = await screen.findByRole('textbox', { name: /Texto da marca/ });
    expect(screen.getByText('7/32')).toBeInTheDocument();

    fireEvent.change(field, { target: { value: '' } });
    expect(screen.getByText('Digite o texto da marca.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Salvar' })).toBeDisabled();

    fireEvent.change(field, { target: { value: 'a'.repeat(33) } });
    expect(screen.getByText('Use no máximo 32 caracteres.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Salvar' })).toBeDisabled();

    fireEvent.change(field, { target: { value: 'Ana Ofertas' } });
    expect(screen.getByText('11/32')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Salvar' })).toBeEnabled();
  });

  it('opacidade pelo slider muda a prévia; rascunho sobrevive e é limpo ao salvar', async () => {
    svc.get.mockResolvedValue(base);
    svc.update.mockImplementation(async (input) => ({ ...base, ...input }));
    renderPage();
    const slider = await screen.findByRole('slider', { name: /Opacidade/ });
    expect(slider).toHaveAttribute('aria-valuemin', '20');
    expect(slider).toHaveAttribute('aria-valuemax', '100');
    fireEvent.keyDown(slider, { key: 'ArrowLeft' });
    expect(slider).toHaveAttribute('aria-valuenow', '75');
    expect(screen.getByTestId('watermark-mark')).toHaveStyle({ opacity: '0.75' });

    fireEvent.click(screen.getByRole('radio', { name: 'Canto superior esquerdo' }));
    expect(screen.getByTestId('watermark-mark')).toHaveAttribute('data-position', 'TOP_LEFT');
    expect(JSON.parse(sessionStorage.getItem(DRAFT_KEY)!).d).toMatchObject({ opacity: 75, position: 'TOP_LEFT' });

    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    await waitFor(() => expect(svc.update).toHaveBeenCalledWith(expect.objectContaining({ opacity: 75, position: 'TOP_LEFT', text: null })));
    expect(await screen.findByText('Marca d\'água salva.')).toBeInTheDocument();
    expect(sessionStorage.getItem(DRAFT_KEY)).toBeNull();
  });

  it('rascunho salvo na aba volta depois do reload', async () => {
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ v: 1, d: { enabled: true, kind: 'IMAGE', text: '', position: 'CENTER', size: 'LARGE', opacity: 40 } }));
    svc.get.mockResolvedValue(base);
    renderPage();
    expect(await screen.findByRole('radio', { name: 'Centro' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText('Alterações não salvas')).toBeInTheDocument();
    expect(screen.getByText('Envie um logo para a marca sair nas ofertas.')).toBeInTheDocument();
  });

  it('somente leitura (canEdit false): controles travados, sem barra de salvar', async () => {
    svc.get.mockResolvedValue({ ...base, canEdit: false });
    renderPage();
    expect(await screen.findByText(/Só os administradores da conta alteram/)).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /Aplicar a marca nas ofertas/ })).toBeDisabled();
    expect(screen.getByRole('slider', { name: /Opacidade/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Enviar logo' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Salvar' })).not.toBeInTheDocument();
  });

  it('403 de plano: estado bloqueado com selo MAX e link para os planos', async () => {
    svc.get.mockRejectedValue({ status: 403, code: 'PLAN_FEATURE_UNAVAILABLE', meta: { key: 'offer_watermark_enabled' } });
    renderPage();
    const locked = await screen.findByTestId('watermark-locked');
    expect(within(locked).getByRole('img', { name: /MAX/ })).toBeInTheDocument();
    expect(within(locked).getByRole('link', { name: 'Ver planos' })).toHaveAttribute('href', '/affiliates/plans?feature=offerWatermark');
  });

  it('404 (fora da audiência): sai para o dashboard', async () => {
    svc.get.mockRejectedValue({ status: 404, code: 'NOT_FOUND' });
    renderPage();
    expect(await screen.findByText('dashboard')).toBeInTheDocument();
  });

  it('erro do logo: 415 mostra a mensagem de tipo', async () => {
    svc.get.mockResolvedValue(base);
    renderPage();
    const input = await screen.findByTestId('watermark-logo-input');
    fireEvent.change(input, { target: { files: [new File(['x'], 'l.jpg', { type: 'image/jpeg' })] } });
    expect(await screen.findByText('Use um PNG ou WebP com fundo transparente.')).toHaveAttribute('role', 'alert');
  });

  it('aviso do Telegram (foto com legenda; prévia do painel não mostra)', async () => {
    svc.get.mockResolvedValue(base);
    renderPage();
    expect(await screen.findByText('No Telegram, a oferta com marca chega como foto com legenda')).toBeInTheDocument();
    expect(screen.getByText(/A prévia da oferta no painel continua mostrando o cartão de link/)).toBeInTheDocument();
  });
});
