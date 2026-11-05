import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { renderWithTheme } from '@/test/renderWithTheme';
import { PrivacyProvider } from '@/features/privacy';
import { PLAN_CATALOG } from '@/features/plans/catalog';
import { subscriptionStrings as t } from '@/features/subscription/strings';
import type { SubscriptionResponse } from '@/types/api.types';

const svc = vi.hoisted(() => ({ getSubscription: vi.fn() }));
vi.mock('@/services/subscription.service', () => ({ subscriptionService: svc }));

const tenant = vi.hoisted(() => ({ value: { activeTenantId: 't1', tenants: [] as Array<{ id: string; role: string }> } }));
vi.mock('@/contexts/TenantContext', () => ({ useTenant: () => tenant.value }));

import { SubscriptionPage } from './SubscriptionPage';
import { SettingsLayout } from '@/features/settings/components/SettingsLayout';

const pro = PLAN_CATALOG.find((p) => p.slug === 'profissional')!;

const sub: SubscriptionResponse = {
  tenantName: 'Loja da Ana',
  planSlug: 'profissional',
  status: 'ACTIVE',
  suspendedAt: null,
  expiresAt: null,
  limits: [
    { key: 'whatsapp_sessions', channel: 'whatsapp', kind: 'count', used: 1, limit: 3, enabled: true },
    { key: 'telegram_sessions', channel: 'telegram', kind: 'count', used: 0, limit: 2, enabled: true },
  ],
};

const renderPage = (path = '/settings/subscription', mode: 'light' | 'dark' = 'light') =>
  renderWithTheme(
    <MemoryRouter initialEntries={[path]}>
      <PrivacyProvider>
        <Routes>
          <Route path="/settings" element={<SettingsLayout />}>
            <Route path="subscription" element={<SubscriptionPage />} />
          </Route>
        </Routes>
      </PrivacyProvider>
    </MemoryRouter>,
    mode,
  );

const rowKeys = () => Array.from(document.querySelectorAll('tr[data-key]')).map((r) => r.getAttribute('data-key'));

describe('SubscriptionPage', () => {
  beforeEach(() => {
    sessionStorage.clear();
    svc.getSubscription.mockReset();
    tenant.value = { activeTenantId: 't1', tenants: [] };
  });

  it('skeleton enquanto carrega, depois card e tabela; item do menu ativo', async () => {
    let resolve!: (v: SubscriptionResponse) => void;
    svc.getSubscription.mockReturnValue(new Promise((r) => { resolve = r; }));
    renderPage();
    expect(document.querySelector('[aria-busy="true"]')).not.toBeNull();
    resolve(sub);
    expect(await screen.findByText(pro.name)).toBeInTheDocument();
    expect(document.querySelector('[aria-busy="true"]')).toBeNull();
    expect(rowKeys()).toEqual(['whatsapp_sessions']);
    const item = screen.getByRole('button', { name: t.menuLabel });
    expect(item).toHaveClass('Mui-selected');
  });

  it('erro mostra tentar de novo e recarrega', async () => {
    svc.getSubscription.mockRejectedValueOnce({ status: 500 });
    renderPage('/settings/subscription', 'dark');
    expect(await screen.findByText(t.page.loadError)).toBeInTheDocument();
    svc.getSubscription.mockResolvedValue(sub);
    fireEvent.click(screen.getByRole('button', { name: t.page.retry }));
    expect(await screen.findByText(pro.name)).toBeInTheDocument();
    expect(svc.getSubscription).toHaveBeenCalledTimes(2);
  });

  it('aba de canal persiste no sessionStorage (escopo tab)', async () => {
    svc.getSubscription.mockResolvedValue(sub);
    const { unmount } = renderPage();
    await screen.findByText(pro.name);
    fireEvent.click(screen.getByRole('tab', { name: new RegExp(t.channel.telegram) }));
    await waitFor(() => expect(rowKeys()).toEqual(['telegram_sessions']));
    unmount();
    renderPage();
    await screen.findByText(pro.name);
    expect(rowKeys()).toEqual(['telegram_sessions']);
  });

  it('OPERATOR não vê o botão de assinar (D4)', async () => {
    tenant.value = { activeTenantId: 't1', tenants: [{ id: 't1', role: 'OPERATOR' }] };
    svc.getSubscription.mockResolvedValue(sub);
    renderPage();
    expect(await screen.findByText(t.cta.operatorHint)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: new RegExp(t.cta.label) })).toBeNull();
  });

  it('?suspended=1 com tenant suspenso mostra o motivo do redirecionamento', async () => {
    svc.getSubscription.mockResolvedValue({ ...sub, status: 'SUSPENDED', suspendedAt: '2026-11-01T12:00:00.000Z' });
    renderPage('/settings/subscription?suspended=1');
    expect(await screen.findByText(t.pending.redirected)).toBeInTheDocument();
    expect(screen.getByText(t.pending.SUSPENDED.title)).toBeInTheDocument();
  });
});
