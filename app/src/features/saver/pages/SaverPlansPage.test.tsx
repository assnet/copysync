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
});

describe('SaverPlansPage', () => {
  it.each(['light', 'dark'] as const)('três planos com anual padrão e total do ano (%s)', async (mode) => {
    sub.getSubscription.mockResolvedValue(withSaver(null));
    page(mode);
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual(['LITE', 'PRO', 'MAX']);
    const text = norm(document.body.textContent ?? '');
    for (const v of [23.9, 32.9, 39.9]) expect(text).toContain(norm(formatPrice(v)));
    expect(text).toContain(norm(t.card.annualBilled(286.8)));
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
    expect(screen.getAllByRole('link', { name: t.card.cta })).toHaveLength(2);
  });

  it('operador vê a orientação no lugar do botão; falha da assinatura não quebra', async () => {
    tenant.value = { activeTenantId: 't1', tenants: [{ id: 't1', role: 'OPERATOR' }] };
    sub.getSubscription.mockRejectedValue(new Error('x'));
    page();
    expect(screen.getAllByText(t.card.operatorHint)).toHaveLength(3);
    expect(screen.queryByRole('link', { name: t.card.cta })).toBeNull();
  });
});
