import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { renderWithTheme } from '@/test/renderWithTheme';
import { formatPrice } from '@/features/plans/strings';

const sub = vi.hoisted(() => ({ getSubscription: vi.fn() }));
const tenant = vi.hoisted(() => ({ value: { activeTenantId: 't1', tenants: [{ id: 't1', role: 'ADMIN' }] } }));
vi.mock('@/services/subscription.service', () => ({ subscriptionService: sub }));
vi.mock('@/contexts/TenantContext', () => ({ useTenant: () => tenant.value }));
const auth = vi.hoisted(() => ({ user: { id: 'u1', isSuperAdmin: false } }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => auth }));

import { SaverPlansPage } from './SaverPlansPage';
import { saverPlansStrings as t } from '../plans/strings';

const withSaver = (planSlug: string | null) => ({
  tenantName: 'x', planSlug: null, status: 'ACTIVE', suspendedAt: null, expiresAt: null, limits: [],
  products: planSlug ? [{ product: 'SAVER', planSlug, tier: 'pro', expiresAt: null, source: 'ADMIN' }] : [],
});
const page = (mode: 'light' | 'dark' = 'light') =>
  renderWithTheme(<MemoryRouter><SaverPlansPage /></MemoryRouter>, mode);
const norm = (s: string) => s.replace(/ /g, ' ');

beforeEach(() => {
  vi.clearAllMocks();
  window.sessionStorage.clear();
  tenant.value = { activeTenantId: 't1', tenants: [{ id: 't1', role: 'ADMIN' }] };
  auth.user.isSuperAdmin = false;
});

describe('SaverPlansPage', () => {
  it.each(['light', 'dark'] as const)('três planos com anual padrão e total do ano (%s)', async (mode) => {
    sub.getSubscription.mockResolvedValue(withSaver(null));
    page(mode);
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual(['LITE', 'PRO', 'MAX']);
    const text = norm(document.body.textContent ?? '');
    for (const v of [23.9, 32.9, 39.9]) expect(text).toContain(norm(formatPrice(v)));
    expect(text).toContain(norm(t.card.annualBilled(23.9, 231.38)));
    expect(text).toContain(t.limits.groups(null));
    expect(text).toContain(t.limits.sessions(2));
    expect(screen.getByText(t.hiddenNumber.title)).toBeInTheDocument();
  });

  it('mensal troca os preços e o período persiste', async () => {
    sub.getSubscription.mockResolvedValue(withSaver(null));
    const user = userEvent.setup();
    const first = page();
    await user.click(screen.getByRole('button', { name: t.period.monthly }));
    expect(norm(document.body.textContent ?? '')).toContain(norm(formatPrice(29.9)));
    first.unmount();
    page();
    expect(screen.getByRole('button', { name: t.period.monthly })).toHaveAttribute('aria-pressed', 'true');
  });

  it('plano atual em destaque e sem botão de assinar nele', async () => {
    sub.getSubscription.mockResolvedValue(withSaver('SAVER_PRO'));
    page();
    await waitFor(() => expect(document.querySelector('[data-current="true"]')?.getAttribute('data-plan')).toBe('SAVER_PRO'));
    expect(screen.getByText(t.card.current)).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: /^Assinar / })).toHaveLength(2);
  });

  it('botão de assinar usa o link de redirecionamento do plano e do período', async () => {
    sub.getSubscription.mockResolvedValue(withSaver(null));
    page();
    const lite = await screen.findByRole('link', { name: t.card.cta('LITE') });
    expect(lite.getAttribute('href')).toMatch(/^\/redirect\/saver-lite-(anual|mensal)$/);
    expect(lite.getAttribute('target')).toBe('_blank');
  });

  it('operador vê a orientação no lugar do botão; falha da assinatura não quebra', async () => {
    tenant.value = { activeTenantId: 't1', tenants: [{ id: 't1', role: 'OPERATOR' }] };
    sub.getSubscription.mockRejectedValue(new Error('x'));
    page();
    expect(screen.getAllByText(t.card.operatorHint)).toHaveLength(3);
    expect(screen.queryByRole('link', { name: /^Assinar / })).toBeNull();
  });

  it('super admin sem papel na conta vê os botões, não a orientação do operador', async () => {
    auth.user.isSuperAdmin = true;
    tenant.value = { activeTenantId: 't1', tenants: [] };
    sub.getSubscription.mockResolvedValue(withSaver(null));
    page();
    expect(screen.queryByText(t.card.operatorHint)).toBeNull();
    expect(screen.getAllByRole('link', { name: /^Assinar / })).toHaveLength(3);
  });
});
