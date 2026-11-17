import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { renderWithTheme } from '@/test/renderWithTheme';
import { DEFAULT_USAGE_FILTERS } from '../rules';
import { featureUsageStrings as S } from '../strings';
import { summaryFixture } from '../testFixtures';
import type { UsageFilters } from '../types';
import { UsagePageContext, type UsagePageValue } from '../hooks/useUsagePage';
import PlansTab from './PlansTab';

const t = S.plansTab;

function renderTab(filters: UsageFilters = DEFAULT_USAGE_FILTERS) {
  const value: UsagePageValue = {
    filters,
    setFilters: vi.fn(),
    query: {},
    maxDays: 90,
    summary: { data: summaryFixture(), loading: false, error: false, slow: false, unavailable: false, ready: true, reload: vi.fn() },
    refreshKey: 0,
    reportMaxDays: vi.fn(),
    featureKey: null,
    accountNames: { remember: vi.fn(), nameOf: () => undefined },
  };
  return renderWithTheme(
    <MemoryRouter>
      <UsagePageContext.Provider value={value}><PlansTab /></UsagePageContext.Provider>
    </MemoryRouter>,
  );
}

beforeEach(() => window.sessionStorage.clear());
afterEach(() => window.sessionStorage.clear());

describe('PlansTab', () => {
  it('abre em Afiliados e a escolha de família sobrevive ao reload', async () => {
    const first = renderTab();
    expect(screen.getByRole('table', { name: t.aria(S.planFamilies.AFFILIATES) })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: S.planFamilies.SAVER }));
    expect(screen.getByRole('table', { name: t.aria(S.planFamilies.SAVER) })).toBeInTheDocument();
    first.unmount();
    renderTab();
    expect(screen.getByRole('table', { name: t.aria(S.planFamilies.SAVER) })).toBeInTheDocument();
  });

  it('com plano do Saver no filtro, só a família Saver e sem seletor', () => {
    window.sessionStorage.clear();
    renderTab({ ...DEFAULT_USAGE_FILTERS, plan: 'SAVER_PRO' });
    expect(screen.getByRole('table', { name: t.aria(S.planFamilies.SAVER) })).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: t.family })).toBeNull();
  });
});
