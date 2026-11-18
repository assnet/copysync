import { describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { renderWithTheme } from '@/test/renderWithTheme';
import { usageFeaturePath } from '../paths';
import { featureUsageStrings as S } from '../strings';
import { summaryFixture } from '../testFixtures';
import type { UsagePlanFamily } from '../types';
import { PlanMatrixTable } from './PlanMatrixTable';

const t = S.plansTab;

function renderMatrix(family: UsagePlanFamily, mode: 'light' | 'dark' = 'light', onFamilyChange = vi.fn()) {
  const summary = summaryFixture();
  renderWithTheme(
    <MemoryRouter>
      <PlanMatrixTable summary={summary} families={['AFFILIATES', 'SAVER']} family={family} onFamilyChange={onFamilyChange} sort="tenants" />
    </MemoryRouter>,
    mode,
  );
  return screen.getByRole('table', { name: t.aria(S.planFamilies[family]) });
}

const headers = (table: HTMLElement) =>
  within(table).getAllByRole('columnheader').map((th) => th.textContent ?? '');

describe('PlanMatrixTable', () => {
  it.each(['light', 'dark'] as const)('família Afiliados: colunas COPYSYNC_* + sem plano, células "x de y" (%s)', (mode) => {
    const table = renderMatrix('AFFILIATES', mode);
    const cols = headers(table);
    expect(cols).toHaveLength(7);
    expect(cols[1]).toContain(S.plans.COPYSYNC_LITE);
    expect(cols[1]).toContain(t.planTenants('5'));
    expect(cols[4]).toContain(S.plans.NONE);
    expect(cols.join()).not.toContain(S.plans.SAVER_PRO);
    // Saver não aparece na família Afiliados.
    expect(within(table).queryByText(S.features.saver_extraction.label)).toBeNull();
    const row = within(table).getByRole('row', { name: new RegExp(S.features.offer_generator.label) });
    expect(within(row).getByText(t.cell('4', '4'))).toBeInTheDocument();
    expect(within(row).getByText(t.cellAria(S.features.offer_generator.label, S.plans.COPYSYNC_LITE, '2', '5', '61'))).toBeInTheDocument();
    expect(within(row).getByRole('link', { name: S.features.offer_generator.label })).toHaveAttribute('href', usageFeaturePath('offer_generator'));
  });

  it('família Saver: plano sem conta mostra "—" e não "0%"; denominador de population.byPlan', () => {
    const table = renderMatrix('SAVER');
    const cols = headers(table);
    expect(cols).toHaveLength(7);
    expect(cols[2]).toContain(t.planTenants('2'));
    expect(cols[4]).toContain(t.planTenants('13'));
    const row = within(table).getByRole('row', { name: new RegExp(S.features.saver_extraction.label) });
    expect(within(row).getAllByText(t.noTenants)).toHaveLength(2);
    const cells = within(row).getAllByRole('cell');
    expect(cells.map((c) => c.textContent)).toEqual([
      t.noTenants, expect.stringContaining(t.cell('2', '2')), t.noTenants, expect.stringContaining(t.cell('0', '13')),
      '67%', expect.stringMatching(/%$/),
    ]);
    // "0%" só onde há contas no plano (sem plano: 0 de 13), nunca no plano vazio.
    expect(cells[0].textContent).not.toContain('0%');
    expect(within(row).getByText(t.cell('2', '2'))).toBeInTheDocument();
    expect(within(table).queryByText(S.features.offer_generator.label)).toBeNull();
    // Nenhuma linha de total somando famílias.
    expect(within(table).getAllByRole('row')).toHaveLength(2);
  });

  it('sem conta sem plano na família, a coluna NONE some', () => {
    const summary = summaryFixture();
    summary.population.byPlan = summary.population.byPlan.filter((p) => !(p.family === 'SAVER' && p.plan === 'NONE'));
    renderWithTheme(
      <MemoryRouter>
        <PlanMatrixTable summary={summary} families={['SAVER']} family="SAVER" onFamilyChange={vi.fn()} sort="tenants" />
      </MemoryRouter>,
    );
    const table = screen.getByRole('table');
    expect(headers(table)).toHaveLength(6);
    // Com uma família só, o seletor some.
    expect(screen.queryByRole('group', { name: t.family })).toBeNull();
  });

  it('troca de família pelo seletor', async () => {
    const onFamilyChange = vi.fn();
    renderMatrix('AFFILIATES', 'light', onFamilyChange);
    await userEvent.click(screen.getByRole('button', { name: S.planFamilies.SAVER }));
    expect(onFamilyChange).toHaveBeenCalledWith('SAVER');
  });
});
