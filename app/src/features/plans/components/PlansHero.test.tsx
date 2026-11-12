import { describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import { renderWithTheme } from '@/test/renderWithTheme';
import { PlansHero } from './PlansHero';
import { plansStrings as t } from '../strings';

describe('PlansHero', () => {
  it.each(['light', 'dark'] as const)('mostra os 4 marketplaces integrados, só Shein com selo (MAX) (%s)', (mode) => {
    renderWithTheme(<PlansHero period="monthly" onPeriodChange={vi.fn()} />, mode);
    const list = screen.getByRole('list', { name: t.hero.marketplaces });
    const items = within(list).getAllByRole('listitem');
    expect(items.map((li) => within(li).getAllByText(/./)[0].textContent)).toEqual(['Shopee', 'Mercado Livre', 'Amazon', t.hero.sheinTooltip]);
    expect(within(items[3]).getByText(t.hero.sheinPlan)).toBeInTheDocument();
    for (const i of [0, 1, 2]) expect(within(items[i]).queryByText(t.hero.sheinPlan)).toBeNull();
    expect(screen.queryByText('PRO+')).toBeNull();
  });
});
