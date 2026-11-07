import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { renderWithTheme } from '@/test/renderWithTheme';
import { InvitePage } from '@/pages/InvitePage';
import { APP_NAME } from '@/shared/branding/brand';
import { inviteService, type InviteInfo } from '@/services/invite.service';
import { inviteStrings as t } from './strings';

vi.mock('@/components/ThemeModeSelector', () => ({ ThemeModeSelector: () => null }));

const base: InviteInfo = {
  email: 'ana@x.com', tenantName: 'Loja', role: 'ADMIN', expiresAt: '2026-12-01T00:00:00.000Z',
  requiresPassword: true, requiresLogin: false,
};

const renderInvite = (info: InviteInfo, mode: 'light' | 'dark' = 'light') => {
  vi.spyOn(inviteService, 'getInfo').mockResolvedValue(info);
  return renderWithTheme(
    <MemoryRouter initialEntries={['/invite/tok']}>
      <Routes><Route path="/invite/:token" element={<InvitePage />} /></Routes>
    </MemoryRouter>,
    mode,
  );
};

afterEach(() => vi.restoreAllMocks());

describe('InvitePage', () => {
  it('primeiro acesso de quem comprou: boas-vindas e "Criar senha e entrar"', async () => {
    renderInvite({ ...base, firstAccess: true });
    expect(await screen.findByRole('heading', { name: t.firstAccessTitle(APP_NAME) })).toBeInTheDocument();
    expect(screen.getByText(t.firstAccessSubtitle)).toBeInTheDocument();
    expect(screen.queryByText(t.subtitle)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: t.firstAccessSubmit })).toBeInTheDocument();
  });

  it('convite de equipe mantém o texto de equipe, com acentos (tema escuro)', async () => {
    renderInvite({ ...base, firstAccess: false }, 'dark');
    expect(await screen.findByRole('heading', { name: 'Você foi convidado' })).toBeInTheDocument();
    expect(screen.getByText('Uma equipe quer que você faça parte do painel.')).toBeInTheDocument();
    expect(screen.getByText('Função')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: t.submitCreate })).toBeInTheDocument();
  });

  it('API antiga sem firstAccess: texto de equipe', async () => {
    renderInvite(base);
    expect(await screen.findByText(t.subtitle)).toBeInTheDocument();
  });
});
