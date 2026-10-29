import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { renderWithTheme } from '@/test/renderWithTheme';
import { PrivacyProvider } from '@/features/privacy';
import type { Rotation, RotationOverview } from '../types';
import { linkRotationStrings as t } from '../strings';

const getOverview = vi.hoisted(() => vi.fn());
vi.mock('@/services/linkRotation.service', () => ({ linkRotationService: { getOverview, update: vi.fn() } }));

import { LinkRotationPage } from '@/pages/link-rotation/LinkRotationPage';

const rotation: Rotation = {
  id: 'r1', sessionId: 's1', domainId: 'd1', hostname: 'copysync.com.br', slug: 'promo',
  publicUrl: 'https://promo.copysync.com.br', status: 'ACTIVE', strategy: 'BALANCED', title: null,
  clickCount: 3, lastClickAt: null, allFullNotifiedAt: null, createdAt: '', updatedAt: '', groups: [],
};
const base: RotationOverview = {
  rotations: [], domains: [{ id: 'd1', hostname: 'copysync.com.br' }],
  limits: { linkRotations: 1, linkRotationGroups: 3 }, sessions: [{ id: 's1', name: 'Loja', status: 'CONNECTED' }],
};

const renderPage = (mode: 'light' | 'dark' = 'light') =>
  renderWithTheme(<MemoryRouter><PrivacyProvider><LinkRotationPage /></PrivacyProvider></MemoryRouter>, mode);

describe('LinkRotationPage', () => {
  beforeEach(() => { sessionStorage.clear(); getOverview.mockReset(); });

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

  it('no limite, criar abre o aviso de upgrade', async () => {
    getOverview.mockResolvedValue({ ...base, rotations: [rotation] });
    renderPage();
    expect(await screen.findByText('promo.copysync.com.br')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: t.page.create }));
    expect(await screen.findByText(t.upgrade.rotationsTitle)).toBeInTheDocument();
  });
});
