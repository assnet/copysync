import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, screen } from '@testing-library/react';
import { renderWithTheme } from '@/test/renderWithTheme';
import { featureUsageStrings as S } from '../strings';
import { CONTEXT_CLOCK_MS, UsageContextLine } from './UsageSummaryGate';

let now = Date.UTC(2026, 10, 18, 0, 40, 0);
vi.mock('@/services/serverClock', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/serverClock')>()),
  serverNow: () => now,
}));

afterEach(() => vi.useRealTimers());

describe('UsageContextLine', () => {
  it('relógio reativo: o aviso de dado antigo aparece sem nova leitura', () => {
    vi.useFakeTimers();
    renderWithTheme(<UsageContextLine features={[]} freshAt="2026-11-18T00:20:00.000Z" source="daily" />);
    expect(screen.queryByText(S.context.stale('20 min'))).toBeNull();
    expect(screen.queryByText(S.context.stale('31 min'))).toBeNull();
    now += 11 * 60_000;
    act(() => { vi.advanceTimersByTime(CONTEXT_CLOCK_MS); });
    expect(screen.getByText(S.context.stale('31 min'))).toBeInTheDocument();
  });

  it('selo de leitura direta diz o motivo vindo da API', () => {
    const { unmount } = renderWithTheme(<UsageContextLine features={[]} freshAt="2026-11-18T00:40:00.000Z" source="live" liveReason="NOT_COVERED" />);
    expect(screen.getByLabelText(`${S.context.liveBadge}. ${S.context.liveReasons.NOT_COVERED} ${S.context.liveHint}`)).toBeInTheDocument();
    unmount();
    renderWithTheme(<UsageContextLine features={[]} freshAt="2026-11-18T00:40:00.000Z" source="live" liveReason="STALE" />);
    expect(screen.getByLabelText(`${S.context.liveBadge}. ${S.context.liveReasons.STALE} ${S.context.liveHint}`)).toBeInTheDocument();
  });
});
