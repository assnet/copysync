import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithTheme } from '@/test/renderWithTheme';
import { PLAN_CATALOG } from '../catalog';
import { buildCheckoutUrl } from '../checkout';
import { plansStrings as t } from '../strings';
import { PlanCard } from './PlanCard';

describe('PlanCard', () => {
  it.each(['light', 'dark'] as const)('"Assinar" abre o pagamento do período em nova aba (%s)', (mode) => {
    const max = PLAN_CATALOG.find((p) => p.slug === 'max')!;
    renderWithTheme(<PlanCard plan={max} period="annual" checkoutHref={buildCheckoutUrl('max', 'annual')!} />, mode);
    const link = screen.getByRole('link', { name: t.card.ctaNewTab(max.name) });
    expect(link).toHaveAttribute('href', max.checkoutUrls.annual);
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(link).toHaveTextContent(t.card.cta(max.name));
  });
});
