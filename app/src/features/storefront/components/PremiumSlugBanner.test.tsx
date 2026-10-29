import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithTheme } from '@/test/renderWithTheme';
import { PREMIUM_SLUG_OFFER } from '@/features/plans/catalog';
import { storefrontStrings } from '../strings';
import { PremiumSlugBanner } from './PremiumSlugBanner';

const t = storefrontStrings.premium;

describe('PremiumSlugBanner', () => {
  it('sem checkout mostra título, benefícios, preço e "Em breve" desabilitado', () => {
    renderWithTheme(<PremiumSlugBanner open checkoutUrl={null} />, 'dark');
    expect(screen.getByText(PREMIUM_SLUG_OFFER.title)).toBeInTheDocument();
    for (const b of PREMIUM_SLUG_OFFER.benefits) expect(screen.getByText(b)).toBeInTheDocument();
    expect(screen.getByText(PREMIUM_SLUG_OFFER.priceLabel)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: t.soon })).toBeDisabled();
    expect(screen.queryByText(t.buy)).not.toBeInTheDocument();
  });

  it('com checkout mostra o link Comprar numa nova aba', () => {
    renderWithTheme(<PremiumSlugBanner open checkoutUrl="https://pagar.exemplo/x" />);
    const buy = screen.getByRole('link', { name: t.buy });
    expect(buy).toHaveAttribute('href', 'https://pagar.exemplo/x');
    expect(buy).toHaveAttribute('target', '_blank');
  });

  it('fechado não renderiza', () => {
    renderWithTheme(<PremiumSlugBanner open={false} checkoutUrl={null} />);
    expect(screen.queryByText(PREMIUM_SLUG_OFFER.title)).not.toBeInTheDocument();
  });
});
