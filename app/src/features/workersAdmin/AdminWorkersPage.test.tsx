import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithTheme } from '@/test/renderWithTheme';
import { AdminWorkersPage } from '@/pages/admin/AdminWorkersPage';
import { adminWorkersService } from '@/services/adminWorkers.service';
import { workersAdminStrings as t } from './strings';

afterEach(() => vi.restoreAllMocks());

describe('AdminWorkersPage', () => {
  it('vazia: estado vazio e nenhuma sessão aguardando', async () => {
    vi.spyOn(adminWorkersService, 'list').mockResolvedValue({
      workers: [], totals: { workers: 0, sessions: 0, maxSessions: 0 }, awaiting: 0,
    });
    renderWithTheme(<AdminWorkersPage />);
    expect(await screen.findByText(t.empty)).toBeInTheDocument();
    expect(screen.getByText(t.awaiting.none)).toBeInTheDocument();
  });

  it('cheia: linha por worker com barra de ocupação e cartão de espera', async () => {
    vi.spyOn(adminWorkersService, 'list').mockResolvedValue({
      workers: [
        { workerId: 'w-1', role: 'worker', sessions: 40, maxSessions: 40, rssMb: 812, seenAt: new Date().toISOString() },
        { workerId: 'w-2', role: 'all', sessions: 10, maxSessions: 40, rssMb: 300, seenAt: new Date().toISOString() },
      ],
      totals: { workers: 2, sessions: 50, maxSessions: 80 },
      awaiting: 3,
    });
    renderWithTheme(<AdminWorkersPage />);
    expect(await screen.findByText('w-1')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: t.occupancyAria('w-1', 100) })).toBeInTheDocument();
    expect(screen.getByText(t.memoryMb(812))).toBeInTheDocument();
    expect(screen.getByText(t.awaiting.some(3))).toBeInTheDocument();
    expect(screen.getByText(t.totals.capacity(50, 80, 63))).toBeInTheDocument();
  });

  it('erro na 1ª carga mostra alerta com tentar de novo', async () => {
    vi.spyOn(adminWorkersService, 'list').mockRejectedValue(new Error('x'));
    renderWithTheme(<AdminWorkersPage />);
    expect(await screen.findByText(t.errors.generic)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: t.retry })).toBeInTheDocument();
  });
});
