import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { ThemeProvider } from '@mui/material';
import { buildTheme } from '@/theme/theme';
import { renderWithTheme } from '@/test/renderWithTheme';
import { PrivacyProvider } from '@/features/privacy';
import type { RotationGroupStats, RotationStats } from '../types';
import { linkRotationStrings } from '../strings';

const getStats = vi.hoisted(() => vi.fn());
vi.mock('@/services/linkRotation.service', () => ({ linkRotationService: { getStats } }));
vi.mock('@/services/serverClock', () => ({ serverNow: () => Date.parse('2026-10-29T12:00:00Z') }));

import { RotationStatsCard, occupancyColor } from '../components/RotationStatsCard';

const t = linkRotationStrings.stats;

const group = (over: Partial<RotationGroupStats>): RotationGroupStats => ({
  id: 'g1', conversationId: 'c1', groupName: 'Ofertas 1', status: 'ACTIVE',
  clickCount: 40, clicksLast7Days: 12, memberCount: 500, capacity: 1000, ...over,
});

const stats = (over: Partial<RotationStats> = {}): RotationStats => ({
  rotationId: 'r1', clickCount: 1234, clicksLast7Days: 87,
  lastClickAt: '2026-10-29T11:55:00Z', groups: [group({})], ...over,
});

const renderCard = (id = 'r1', mode: 'light' | 'dark' = 'light') =>
  renderWithTheme(<PrivacyProvider><RotationStatsCard rotationId={id} /></PrivacyProvider>, mode);

describe('RotationStatsCard', () => {
  beforeEach(() => { sessionStorage.clear(); localStorage.clear(); getStats.mockReset(); });

  it('mostra totais, último clique relativo e barra com aria-label', async () => {
    getStats.mockResolvedValue(stats());
    renderCard();
    expect(screen.getByTestId('rotation-stats-loading')).toBeInTheDocument();
    expect(await screen.findByText('1.234')).toBeInTheDocument();
    expect(screen.getByText('87')).toBeInTheDocument();
    expect(screen.getByText(t.lastClickRelative(-5 * 60_000))).toBeInTheDocument();
    expect(screen.getByText('Ofertas 1')).toBeInTheDocument();
    expect(screen.getByText(t.groupClicks7d(12))).toBeInTheDocument();
    const bar = screen.getByRole('progressbar', { name: t.occupancyAria(500, 1000, 50) });
    expect(bar).toHaveAttribute('aria-valuenow', '50');
    expect(screen.queryByText(linkRotationStrings.groupStatus.ACTIVE)).not.toBeInTheDocument();
  });

  it('refreshKey novo recarrega os números sem voltar ao esqueleto', async () => {
    getStats.mockResolvedValueOnce(stats({ groups: [] })).mockResolvedValueOnce(stats());
    const ui = (key: string) => (
      <ThemeProvider theme={buildTheme('light')}><PrivacyProvider><RotationStatsCard rotationId="r1" refreshKey={key} /></PrivacyProvider></ThemeProvider>
    );
    const view = render(ui('a'));
    expect(await screen.findByText(t.noGroups)).toBeInTheDocument();
    view.rerender(ui('b'));
    expect(screen.queryByTestId('rotation-stats-loading')).not.toBeInTheDocument();
    expect(await screen.findByText('Ofertas 1')).toBeInTheDocument();
    expect(getStats).toHaveBeenCalledTimes(2);
  });

  it('sem clique e memberCount null: "ainda sem cliques" e "ainda não medido"', async () => {
    getStats.mockResolvedValue(stats({ lastClickAt: null, groups: [group({ memberCount: null, groupName: null })] }));
    renderCard('r1', 'dark');
    expect(await screen.findByText(t.never)).toBeInTheDocument();
    expect(screen.getByText(t.notMeasured)).toBeInTheDocument();
    expect(screen.getByRole('img', { name: t.notMeasuredAria })).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(screen.getByText(t.untitledGroup)).toBeInTheDocument();
  });

  it('chips de FULL, NEEDS_LINK e PAUSED_BY_PLAN com explicação', async () => {
    getStats.mockResolvedValue(stats({
      groups: [
        group({ id: 'a', status: 'FULL', memberCount: 1000 }),
        group({ id: 'b', status: 'NEEDS_LINK' }),
        group({ id: 'c', status: 'PAUSED_BY_PLAN' }),
      ],
    }));
    renderCard();
    for (const s of ['FULL', 'NEEDS_LINK', 'PAUSED_BY_PLAN'] as const) {
      const chip = await screen.findByText(linkRotationStrings.groupStatus[s]);
      expect(chip.closest('.MuiChip-root')).toHaveAccessibleDescription(linkRotationStrings.groupStatusHelp[s]);
    }
    const items = screen.getAllByRole('listitem');
    expect(within(items[0]).getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100');
  });

  it('erro mostra tentar de novo e recarrega', async () => {
    getStats.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce(stats());
    renderCard();
    const retry = await screen.findByRole('button', { name: t.retry });
    fireEvent.click(retry);
    expect(await screen.findByText('1.234')).toBeInTheDocument();
    expect(getStats).toHaveBeenCalledTimes(2);
  });

  it('recarrega quando rotationId muda e pelo botão atualizar', async () => {
    getStats.mockResolvedValue(stats());
    const view = renderCard('r1');
    await screen.findByText('1.234');
    view.rerender(<PrivacyProvider><RotationStatsCard rotationId="r2" /></PrivacyProvider>);
    await screen.findByText('1.234');
    expect(getStats).toHaveBeenLastCalledWith('r2');
    fireEvent.click(screen.getByRole('button', { name: t.refresh }));
    await vi.waitFor(() => expect(getStats).toHaveBeenCalledTimes(3));
  });

  it('faixas de cor da ocupação', () => {
    expect(occupancyColor(10)).toBe('success');
    expect(occupancyColor(75)).toBe('warning');
    expect(occupancyColor(95)).toBe('error');
  });
});
