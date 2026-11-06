import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { renderWithTheme } from '@/test/renderWithTheme';
import { PrivacyProvider } from '@/features/privacy';
import { AFFILIATE_PLANS_PATH } from '@/features/navigation';
import { PLAN_CATALOG } from '@/features/plans/catalog';
import type { SubscriptionResponse } from '@/types/api.types';
import { subscriptionStrings as t } from '../strings';
import { SubscriptionPlanCard, type SubscriptionPlanCardProps } from './SubscriptionPlanCard';

const pro = PLAN_CATALOG.find((p) => p.slug === 'pro')!;
const fmt = (iso: string) => new Intl.DateTimeFormat('pt-BR', { dateStyle: 'long' }).format(new Date(iso));
const FUTURE = '2999-01-15T12:00:00.000Z';
const PAST = '2001-01-15T12:00:00.000Z';

const base: SubscriptionResponse = {
  tenantName: 'Loja da Ana', planSlug: 'pro', status: 'ACTIVE', suspendedAt: null, expiresAt: FUTURE, limits: [],
};

const setup = (sub: Partial<SubscriptionResponse> = {}, mode: 'light' | 'dark' = 'light', props: Partial<SubscriptionPlanCardProps> = {}) =>
  renderWithTheme(
    <MemoryRouter>
      <PrivacyProvider>
        <SubscriptionPlanCard subscription={{ ...base, ...sub }} search="?utm_source=x&foo=1" canSubscribe {...props} />
      </PrivacyProvider>
    </MemoryRouter>,
    mode,
  );

const cta = () => screen.getByRole('link', { name: new RegExp(t.cta.label) });


describe('SubscriptionPlanCard', () => {
  it('ACTIVE: nome, tagline, chip success, renovação, conta e sem preço', () => {
    const { container } = setup();
    expect(screen.getByText(pro.name)).toBeInTheDocument();
    expect(screen.getByText(pro.tagline)).toBeInTheDocument();
    expect(screen.getByLabelText(`${t.status.label}: ${t.status.ACTIVE}`)).toHaveClass('MuiChip-colorSuccess');
    expect(screen.getByText(t.expiry.renewsOn(fmt(FUTURE)))).toBeInTheDocument();
    expect(screen.getByText(`${t.plan.tenantLabel}: Loja da Ana`)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(container.textContent).not.toMatch(/R\$/);
  });

  it('CTA abre o pagamento mensal do plano em nova aba repassando utm', () => {
    setup();
    const link = cta();
    expect(link).toHaveAttribute('href', `${pro.checkoutUrls.monthly}?utm_source=x`);
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(link).toHaveAccessibleName(t.cta.newTab);
  });

  it('SUSPENDED (escuro): chip warning, aviso e data da suspensão', () => {
    const at = '2026-10-01T15:00:00.000Z';
    setup({ status: 'SUSPENDED', suspendedAt: at }, 'dark');
    expect(screen.getByLabelText(`${t.status.label}: ${t.status.SUSPENDED}`)).toHaveClass('MuiChip-colorWarning');
    const alert = screen.getByRole('alert');
    expect(alert).toHaveClass('MuiAlert-standardWarning');
    expect(alert).toHaveTextContent(t.pending.SUSPENDED.title);
    expect(screen.getByText(t.expiry.suspendedOn(fmt(at)))).toBeInTheDocument();
  });

  it('CANCELLED: chip error, aviso warning e vencimento passado', () => {
    setup({ status: 'CANCELLED', expiresAt: PAST });
    expect(screen.getByLabelText(`${t.status.label}: ${t.status.CANCELLED}`)).toHaveClass('MuiChip-colorError');
    expect(screen.getByRole('alert')).toHaveTextContent(t.pending.CANCELLED.title);
    expect(screen.getByText(t.expiry.expiredOn(fmt(PAST)))).toBeInTheDocument();
  });

  it('sem plano (escuro): textos padrão, chip default, sem vencimento e CTA na vitrine interna', () => {
    setup({ planSlug: null, expiresAt: null }, 'dark');
    expect(screen.getByRole('heading', { name: t.plan.noPlan })).toBeInTheDocument();
    expect(screen.getByText(t.plan.noPlanTagline)).toBeInTheDocument();
    expect(screen.getByLabelText(`${t.status.label}: ${t.status.noPlan}`)).toHaveClass('MuiChip-colorDefault');
    expect(screen.queryByText(/Renova em|Venceu em/)).toBeNull();
    expect(cta()).toHaveAttribute('href', AFFILIATE_PLANS_PATH);
  });

  it('sem canSubscribe (papel indefinido) não mostra CTA', () => {
    renderWithTheme(
      <MemoryRouter>
        <PrivacyProvider>
          <SubscriptionPlanCard subscription={base} search="" />
        </PrivacyProvider>
      </MemoryRouter>,
    );
    expect(screen.queryByRole('link', { name: new RegExp(t.cta.label) })).toBeNull();
  });

  it('OPERATOR não vê CTA, vê o aviso do administrador', () => {
    setup({}, 'light', { canSubscribe: false });
    expect(screen.queryByRole('link', { name: new RegExp(t.cta.label) })).toBeNull();
    expect(screen.getByText(t.cta.operatorHint)).toBeInTheDocument();
  });
});
