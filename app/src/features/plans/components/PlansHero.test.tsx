import { describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import { renderWithTheme } from '@/test/renderWithTheme';
import { PlansHero } from './PlansHero';
import { plansStrings as t } from '../strings';

describe('PlansHero', () => {
  it.each(['light', 'dark'] as const)('mostra os 4 marketplaces integrados, Shein com selo MAX e Mercado Livre com selo de etiquetas (%s)', (mode) => {
    renderWithTheme(<PlansHero period="monthly" onPeriodChange={vi.fn()} />, mode);
    const list = screen.getByRole('list', { name: t.hero.marketplaces });
    const items = within(list).getAllByRole('listitem');
    expect(items.map((li) => within(li).getAllByText(/./)[0].textContent)).toEqual(['Shopee', t.hero.mercadoLivreTagsTooltip, 'Amazon', t.hero.sheinTooltip]);
    expect(within(items[3]).getByText(t.hero.sheinPlan)).toBeInTheDocument();
    expect(within(items[1]).getByText(t.hero.mercadoLivreTagsPlan)).toBeInTheDocument();
    expect(within(items[1]).getByText(t.hero.mercadoLivreTagsTooltip)).toBeInTheDocument();
    expect(within(items[0]).queryByText(t.hero.sheinPlan)).toBeNull();
    expect(within(items[2]).queryByText(t.hero.mercadoLivreTagsPlan)).toBeNull();
  });
});
