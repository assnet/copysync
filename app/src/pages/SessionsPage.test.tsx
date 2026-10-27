import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import type { SessionItem } from '@/types/api.types';

const list = vi.fn();
vi.mock('@/services/session.service', () => ({ sessionService: { list: () => list() } }));
vi.mock('@/features/sessions/components/SessionCard', () => ({ SessionCard: () => null }));
vi.mock('@/features/sessions/components/ConnectSessionDialog', () => ({ ConnectSessionDialog: () => null }));

const created = { id: 'new-1', name: 'Nova' } as SessionItem;
// Assistente falso: "criar" dispara onCreated; "fechar" dispara onClose
vi.mock('@/features/sessions/components/CreateSessionWizard', () => ({
  CreateSessionWizard: ({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (s: SessionItem) => void }) =>
    open ? (
      <div role="dialog">
        <button onClick={() => onCreated(created)}>criar</button>
        <button onClick={onClose}>fechar</button>
      </div>
    ) : null,
}));

import SessionsPage from './SessionsPage';

function Where() {
  const loc = useLocation();
  return <div data-testid="where">{loc.pathname + loc.search}</div>;
}

const renderAt = (url: string) =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/sessions" element={<><SessionsPage /><Where /></>} />
        <Route path="/monitoring" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );

beforeEach(() => {
  list.mockReset();
  list.mockResolvedValue({ sessions: [], total: 0 });
});

describe('SessionsPage com create/returnTo', () => {
  it('abre o assistente, limpa a URL e volta com a sessão criada', async () => {
    renderAt('/sessions?create=1&returnTo=/monitoring');
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByTestId('where')).toHaveTextContent(/^\/sessions$/);
    fireEvent.click(screen.getByText('criar'));
    fireEvent.click(screen.getByText('fechar'));
    expect(await screen.findByTestId('where')).toHaveTextContent('/monitoring?sessionId=new-1');
  });

  it('returnTo externo é ignorado: fecha e fica em sessões', async () => {
    renderAt('/sessions?create=1&returnTo=//evil.com');
    fireEvent.click(await screen.findByText('fechar'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByTestId('where')).toHaveTextContent(/^\/sessions$/);
  });

  it('sem create o assistente começa fechado', async () => {
    renderAt('/sessions');
    await screen.findByTestId('where');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
