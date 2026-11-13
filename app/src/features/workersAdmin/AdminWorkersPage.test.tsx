import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { renderWithTheme } from '@/test/renderWithTheme';
import { AdminWorkersPage } from '@/pages/admin/AdminWorkersPage';
import { adminWorkersService } from '@/services/adminWorkers.service';
import { workersAdminStrings as t } from './strings';

afterEach(() => vi.restoreAllMocks());

describe('AdminWorkersPage', () => {
  it('vazia: estado vazio e nenhuma sessão aguardando', async () => {
    vi.spyOn(adminWorkersService, 'list').mockResolvedValue({
      workers: [], totals: { workers: 0, sessions: 0, pendingLogins: 0, maxSessions: 0 }, awaiting: 0,
    });
    renderWithTheme(<MemoryRouter initialEntries={['/admin/workers']}><AdminWorkersPage /></MemoryRouter>);
    expect(await screen.findByText(t.empty)).toBeInTheDocument();
    expect(screen.getByText(t.awaiting.none)).toBeInTheDocument();
  });

  it('cheia: linha por worker com barra de ocupação e cartão de espera', async () => {
    vi.spyOn(adminWorkersService, 'list').mockResolvedValue({
      workers: [
        { workerId: 'w-1', role: 'worker', sessions: 40, pendingLogins: 3, maxSessions: 40, rssMb: 812, seenAt: new Date().toISOString() },
        { workerId: 'w-2', role: 'all', sessions: 10, pendingLogins: 0, maxSessions: 40, rssMb: 300, seenAt: new Date().toISOString() },
      ],
      totals: { workers: 2, sessions: 50, pendingLogins: 3, maxSessions: 80 },
      awaiting: 3,
    });
    renderWithTheme(<MemoryRouter initialEntries={['/admin/workers']}><AdminWorkersPage /></MemoryRouter>);
    expect(await screen.findByText('w-1')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: t.occupancyAria('w-1', 100) })).toBeInTheDocument();
    expect(screen.getByText(t.memoryMb(812))).toBeInTheDocument();
    expect(screen.getByText(t.awaiting.some(3))).toBeInTheDocument();
    expect(screen.getByText(t.totals.capacity(50, 80, 63))).toBeInTheDocument();
    // T24: logins em andamento em coluna própria, fora da ocupação
    expect(screen.getByText(t.columns.pendingLogins)).toBeInTheDocument();
    const row = screen.getByText('w-1').closest('tr')!;
    expect(within(row).getByText('3')).toBeInTheDocument();
  });

  it('adoção ligada e 0 workers: estado vazio atual, sem aviso de adoção', async () => {
    vi.spyOn(adminWorkersService, 'list').mockResolvedValue({
      adoptionEnabled: true, workers: [], totals: { workers: 0, sessions: 0, pendingLogins: 0, maxSessions: 0 },
      awaiting: 0, processes: [], leasedSessions: 0,
    });
    renderWithTheme(<MemoryRouter initialEntries={['/admin/workers']}><AdminWorkersPage /></MemoryRouter>);
    expect(await screen.findByText(t.empty)).toBeInTheDocument();
    expect(screen.queryByText(t.lease.notice)).not.toBeInTheDocument();
  });

  it('adoção desligada: aviso, processos pelos leases e sessões sem limite (tema escuro)', async () => {
    vi.spyOn(adminWorkersService, 'list').mockResolvedValue({
      adoptionEnabled: false, workers: [], totals: { workers: 0, sessions: 0, pendingLogins: 0, maxSessions: 0 },
      awaiting: 0,
      processes: [
        { workerId: 'api-a', sessions: 2, leaseUntil: new Date().toISOString() },
        { workerId: 'api-b', sessions: 9, leaseUntil: new Date().toISOString() },
      ],
      leasedSessions: 11,
    });
    renderWithTheme(<MemoryRouter initialEntries={['/admin/workers']}><AdminWorkersPage /></MemoryRouter>, 'dark');
    expect(await screen.findByText(t.lease.notice)).toBeInTheDocument();
    expect(screen.getByText(t.lease.sessionsNoCap(11))).toBeInTheDocument();
    expect(screen.queryByText(t.totals.capacity(0, 0, 0))).not.toBeInTheDocument();
    expect(screen.queryByText(t.awaiting.title)).not.toBeInTheDocument();
    const rows = screen.getAllByRole('row').slice(1);
    expect(within(rows[0]).getByText('api-b')).toBeInTheDocument();
    expect(within(rows[0]).getByText('9')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: t.lease.noticeHintAria })).toBeInTheDocument();
  });

  it('adoção desligada sem lease vivo: estado vazio dos processos', async () => {
    vi.spyOn(adminWorkersService, 'list').mockResolvedValue({
      adoptionEnabled: false, workers: [], totals: { workers: 0, sessions: 0, pendingLogins: 0, maxSessions: 0 },
      awaiting: 0, processes: [], leasedSessions: 0,
    });
    renderWithTheme(<MemoryRouter initialEntries={['/admin/workers']}><AdminWorkersPage /></MemoryRouter>);
    expect(await screen.findByText(t.lease.empty)).toBeInTheDocument();
    expect(screen.queryByText(t.empty)).not.toBeInTheDocument();
  });

  it('erro na 1ª carga mostra alerta com tentar de novo', async () => {
    vi.spyOn(adminWorkersService, 'list').mockRejectedValue(new Error('x'));
    renderWithTheme(<MemoryRouter initialEntries={['/admin/workers']}><AdminWorkersPage /></MemoryRouter>);
    expect(await screen.findByText(t.errors.generic)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: t.retry })).toBeInTheDocument();
  });
});
