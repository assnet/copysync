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
