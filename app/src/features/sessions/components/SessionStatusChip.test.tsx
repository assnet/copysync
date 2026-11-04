import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SessionStatusChip } from './SessionStatusChip';
import { sessionStrings } from '../strings';

const t = sessionStrings.awaitingCapacity;

describe('SessionStatusChip', () => {
  it('sem flag mostra o rótulo do status', () => {
    render(<SessionStatusChip status="CONNECTING" />);
    expect(screen.getByText(sessionStrings.status.CONNECTING)).toBeTruthy();
    expect(screen.queryByText(t.label)).toBeNull();
  });

  it('flag desligada mantém o status', () => {
    render(<SessionStatusChip status="PENDING" awaitingCapacity={false} />);
    expect(screen.getByText(sessionStrings.status.PENDING)).toBeTruthy();
  });

  it('flag ligada troca o status por "Aguardando capacidade", warning outlined', () => {
    render(<SessionStatusChip status="CONNECTING" awaitingCapacity />);
    expect(screen.queryByText(sessionStrings.status.CONNECTING)).toBeNull();
    const chip = screen.getByText(t.label).closest('.MuiChip-root') as HTMLElement;
    expect(chip.className).toContain('MuiChip-outlined');
    expect(chip.className).toMatch(/MuiChip-(colorWarning|outlinedWarning)/);
  });

  it('flag ligada explica no tooltip', async () => {
    render(<SessionStatusChip status="PENDING" awaitingCapacity />);
    await userEvent.hover(screen.getByText(t.label));
    expect(await screen.findByText(t.tooltip)).toBeTruthy();
  });
});
