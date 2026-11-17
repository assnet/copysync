import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithTheme } from '@/test/renderWithTheme';
import { DEFAULT_USAGE_FILTERS } from '../rules';
import { featureUsageStrings as S } from '../strings';
import { UsageFiltersBar } from './UsageFiltersBar';
import { renderHook, act } from '@testing-library/react';
import { useLoadedAccountNames } from '../hooks/useLoadedAccountNames';

vi.mock('@/services/serverClock', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/serverClock')>()),
  serverNow: () => Date.UTC(2026, 10, 18, 1, 0, 0),
}));

describe('UsageFiltersBar', () => {
  it('"Dia" fica desabilitado acima de 90 dias', () => {
    renderWithTheme(
      <UsageFiltersBar
        filters={{ ...DEFAULT_USAGE_FILTERS, preset: 'custom', from: '2026-01-01', to: '2026-11-01', granularity: 'week' }}
        onChange={() => {}}
        maxDays={400}
      />,
    );
    expect(screen.getByRole('button', { name: S.filters.granularities.day })).toBeDisabled();
    expect(screen.getByRole('button', { name: S.filters.granularities.week })).toBeEnabled();
  });

  it('chip da conta mostra o id curto sem nome carregado, o nome quando há, e remove o filtro', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const filters = { ...DEFAULT_USAGE_FILTERS, tenantId: '1a2b3c4d5e6f' };
    const view = renderWithTheme(<UsageFiltersBar filters={filters} onChange={onChange} maxDays={90} />, 'dark');
    expect(screen.getByText('Conta 1a2b3c4d')).toBeInTheDocument();
    view.rerender(<UsageFiltersBar filters={filters} onChange={onChange} maxDays={90} accountName="Loja Azul" />);
    expect(screen.getByText('Loja Azul')).toBeInTheDocument();
    await user.click(screen.getByLabelText(S.filters.removeAccount));
    expect(onChange).toHaveBeenCalledWith({ ...filters, tenantId: null });
  });

  it('modo personalizado acompanha o preset: fecha quando ele volta a 30 dias', async () => {
    const user = userEvent.setup();
    const custom = { ...DEFAULT_USAGE_FILTERS, preset: 'custom' as const, from: '2026-11-01', to: '2026-11-10' };
    const view = renderWithTheme(<UsageFiltersBar filters={custom} onChange={() => {}} maxDays={90} />);
    expect(screen.getByLabelText(S.filters.customFrom)).toBeInTheDocument();
    view.rerender(<UsageFiltersBar filters={DEFAULT_USAGE_FILTERS} onChange={() => {}} maxDays={90} />);
    expect(screen.queryByLabelText(S.filters.customFrom)).toBeNull();

    const seven = { ...DEFAULT_USAGE_FILTERS, preset: '7d' as const };
    view.rerender(<UsageFiltersBar filters={seven} onChange={() => {}} maxDays={90} />);
    await user.click(screen.getByRole('button', { name: S.filters.presets.custom }));
    expect(screen.getByLabelText(S.filters.customFrom)).toBeInTheDocument();
    view.rerender(<UsageFiltersBar filters={DEFAULT_USAGE_FILTERS} onChange={() => {}} maxDays={90} />);
    expect(screen.queryByLabelText(S.filters.customFrom)).toBeNull();
  });

  it('personalizado abre com as datas do período atual; acima do teto desabilita "Aplicar período"', async () => {
    window.sessionStorage.clear();
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderWithTheme(<UsageFiltersBar filters={{ ...DEFAULT_USAGE_FILTERS, preset: '7d' }} onChange={onChange} maxDays={90} />);
    await user.click(screen.getByRole('button', { name: S.filters.presets.custom }));
    const from = screen.getByLabelText(S.filters.customFrom) as HTMLInputElement;
    const to = screen.getByLabelText(S.filters.customTo) as HTMLInputElement;
    expect(from.value).toBe('2026-11-11');
    expect(to.value).toBe('2026-11-17');
    const applyButton = screen.getByRole('button', { name: S.filters.customApply });
    expect(applyButton).toBeEnabled();

    await user.clear(from);
    await user.type(from, '2026-01-01');
    expect(applyButton).toBeDisabled();
    expect(screen.getByText(S.periodErrors.tooLong(90))).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('presets acima do teto não aparecem', () => {
    renderWithTheme(<UsageFiltersBar filters={DEFAULT_USAGE_FILTERS} onChange={() => {}} maxDays={30} />);
    expect(screen.queryByRole('button', { name: S.filters.presets['90d'] })).toBeNull();
    expect(screen.getByRole('button', { name: S.filters.presets['30d'] })).toBeInTheDocument();
  });
});

describe('useLoadedAccountNames', () => {
  it('guarda os nomes só em memória e devolve undefined para conta não carregada', () => {
    window.sessionStorage.clear();
    const { result } = renderHook(() => useLoadedAccountNames());
    expect(result.current.nameOf('t1')).toBeUndefined();
    act(() => result.current.remember([{ tenantId: 't1', tenantName: 'Loja Azul' }]));
    expect(result.current.nameOf('t1')).toBe('Loja Azul');
    expect(result.current.nameOf(null)).toBeUndefined();
    expect(JSON.stringify({ ...window.sessionStorage })).not.toContain('Loja Azul');
  });
});
