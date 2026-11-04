import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { renderWithTheme } from '@/test/renderWithTheme';
import { PrivacyProvider } from '@/features/privacy';
import type { Rotation, RotationOverview } from '../types';
import { linkRotationStrings as t } from '../strings';

const { getOverview, remove } = vi.hoisted(() => ({ getOverview: vi.fn(), remove: vi.fn() }));
// Passa pela normalização real (mesmo caminho do serviço): fixtures sem blocos por canal = legado
vi.mock('@/services/linkRotation.service', async () => {
  const { normalizeRotationOverview } = await import('../channelLimits');
  return {
    linkRotationService: {
      getOverview: async () => normalizeRotationOverview(await getOverview()),
      remove, update: vi.fn(), getStats: vi.fn(() => new Promise(() => {})),
    },
  };
});

import { LinkRotationPage } from '@/pages/link-rotation/LinkRotationPage';

const rotation: Rotation = {
  id: 'r1', sessionId: 's1', channel: 'whatsapp', domainId: 'd1', hostname: 'copysync.com.br', slug: 'promo',
  publicUrl: 'https://promo.copysync.com.br', status: 'ACTIVE', strategy: 'BALANCED', title: null,
  clickCount: 3, lastClickAt: null, allFullNotifiedAt: null, createdAt: '', updatedAt: '', groups: [],
};
const base: Omit<RotationOverview, 'limits' | 'usage'> & { limits: Record<string, unknown>; usage?: unknown } = {
  rotations: [], domains: [{ id: 'd1', hostname: 'copysync.com.br' }],
  limits: { linkRotations: 1, linkRotationGroups: 3 }, sessions: [{ id: 's1', name: 'Loja', status: 'CONNECTED', channel: 'whatsapp', avatarUrl: null }],
};

const renderPage = (mode: 'light' | 'dark' = 'light') =>
  renderWithTheme(<MemoryRouter><PrivacyProvider><LinkRotationPage /></PrivacyProvider></MemoryRouter>, mode);

describe('LinkRotationPage', () => {
  beforeEach(() => { sessionStorage.clear(); getOverview.mockReset(); remove.mockReset(); });

  it('estado vazio com CTA', async () => {
    getOverview.mockResolvedValue(base);
    renderPage();
    expect(await screen.findByRole('button', { name: t.empty.cta })).toBeEnabled();
  });

  it('sem domínio: CTA bloqueado com explicação', async () => {
    getOverview.mockResolvedValue({ ...base, domains: [] });
    renderPage('dark');
    expect(await screen.findByText(t.empty.noDomain)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: t.empty.cta })).toBeDisabled();
  });

  it('contador por canal: WhatsApp 1/1 e Telegram a partir do PRO', async () => {
    getOverview.mockResolvedValue({
      ...base, rotations: [rotation],
      limits: { ...base.limits, whatsapp: { rotations: 1, groupsPerRotation: 3 }, telegram: { rotations: 0, groupsPerRotation: 0 } },
      usage: { whatsapp: { rotations: 1 }, telegram: { rotations: 0 } },
    });
    renderPage('dark');
    expect(await screen.findByTestId('rotation-usage-whatsapp')).toHaveTextContent('WhatsApp 1/1');
    expect(screen.getByTestId('rotation-usage-telegram')).toHaveTextContent(t.page.channelUnavailable('Telegram', 'PRO'));
  });

  it('WhatsApp cheio com sessão de Telegram com vaga: criar abre o formulário', async () => {
    getOverview.mockResolvedValue({
      ...base, rotations: [rotation],
      sessions: [...base.sessions, { id: 's2', name: 'TG', status: 'CONNECTED', channel: 'telegram', avatarUrl: null }],
      limits: { ...base.limits, whatsapp: { rotations: 1, groupsPerRotation: 5 }, telegram: { rotations: 1, groupsPerRotation: 5 } },
      usage: { whatsapp: { rotations: 1 }, telegram: { rotations: 0 } },
    });
    renderPage();
    expect(await screen.findByTestId('rotation-usage-telegram')).toHaveTextContent('Telegram 0/1');
    fireEvent.click(screen.getByRole('button', { name: t.page.create }));
    expect(await screen.findByText(t.config.createTitle, { selector: 'h2' })).toBeInTheDocument();
  });

  it('no limite, criar abre o aviso de upgrade', async () => {
    getOverview.mockResolvedValue({ ...base, rotations: [rotation] });
    renderPage();
    expect(await screen.findByText('promo.copysync.com.br')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: t.page.create }));
    expect(await screen.findByText(t.upgrade.rotationsTitle)).toBeInTheDocument();
  });

  it('excluir pede confirmação, chama remove e tira o link da lista', async () => {
    getOverview.mockResolvedValue({ ...base, rotations: [rotation] });
    remove.mockResolvedValue(undefined);
    renderPage();
    expect(await screen.findByText('promo.copysync.com.br')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: t.card.moreActions }));
    fireEvent.click(await screen.findByRole('menuitem', { name: t.card.remove }));
    expect(await screen.findByText(t.card.removeConfirmBody)).toBeInTheDocument();
    expect(remove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: t.card.removeConfirm }));
    await waitFor(() => expect(remove).toHaveBeenCalledWith('r1'));
    expect(await screen.findByText(t.toast.removed)).toBeInTheDocument();
    expect(screen.queryByText('promo.copysync.com.br')).not.toBeInTheDocument();
  });

  it('cancelar a confirmação não exclui', async () => {
    getOverview.mockResolvedValue({ ...base, rotations: [rotation] });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: t.card.moreActions }));
    fireEvent.click(await screen.findByRole('menuitem', { name: t.card.remove }));
    fireEvent.click(await screen.findByRole('button', { name: t.card.removeCancel }));
    expect(remove).not.toHaveBeenCalled();
    expect(screen.getByText('promo.copysync.com.br')).toBeInTheDocument();
  });
});
