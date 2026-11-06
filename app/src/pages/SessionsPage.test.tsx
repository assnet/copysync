import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import type { SessionItem } from '@/types/api.types';

const list = vi.fn();
const limits = vi.fn();
vi.mock('@/services/session.service', () => ({ sessionService: { list: () => list(), limits: () => limits() } }));
vi.mock('@/features/sessions/components/SessionCard', () => ({ SessionCard: () => null }));
vi.mock('@/features/sessions/components/ConnectSessionDialog', () => ({ ConnectSessionDialog: () => null }));
vi.mock('@/features/sessions/components/CreateTelegramSessionWizard', () => ({ CreateTelegramSessionWizard: () => null }));

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
  window.sessionStorage.clear();
  list.mockReset();
  list.mockResolvedValue({ sessions: [], total: 0 });
  limits.mockReset();
  limits.mockResolvedValue({ whatsapp: { used: 0, limit: 1 }, telegram: { used: 0, limit: 1, enabled: true } });
});

describe('SessionsPage com create/returnTo', () => {
  it('create=1 abre o seletor de canal, limpa a URL e volta com a sessão criada', async () => {
    renderAt('/sessions?create=1&returnTo=/monitoring');
    expect(await screen.findByRole('dialog')).toHaveTextContent('Onde você quer postar suas ofertas?');
    expect(screen.getByTestId('where')).toHaveTextContent(/^\/sessions$/);
    expect(screen.queryByText('criar')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'WhatsApp' }));
    fireEvent.click(await screen.findByText('criar'));
    fireEvent.click(screen.getByText('fechar'));
    expect(await screen.findByTestId('where')).toHaveTextContent('/monitoring?sessionId=new-1');
  });

  it('desistir no seletor com returnTo volta para a tela de origem', async () => {
    renderAt('/sessions?create=1&returnTo=/monitoring');
    await screen.findByRole('dialog');
    fireEvent.click(screen.getByRole('button', { name: 'Fechar' }));
    expect(await screen.findByTestId('where')).toHaveTextContent(/^\/monitoring$/);
  });

  it('create=whatsapp abre direto o assistente do WhatsApp', async () => {
    renderAt('/sessions?create=whatsapp');
    expect(await screen.findByText('criar')).toBeInTheDocument();
  });

  it('returnTo externo é ignorado: fecha e fica em sessões', async () => {
    renderAt('/sessions?create=whatsapp&returnTo=//evil.com');
    fireEvent.click(await screen.findByText('fechar'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByTestId('where')).toHaveTextContent(/^\/sessions$/);
  });

  it('sem create o assistente começa fechado', async () => {
    renderAt('/sessions');
    await screen.findByTestId('where');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('create=telegram não abre o assistente do WhatsApp', async () => {
    renderAt('/sessions?create=telegram');
    await screen.findByTestId('where');
    expect(screen.queryByText('criar')).not.toBeInTheDocument();
  });

  it('"Nova sessão" abre o seletor de canal com os contadores do plano', async () => {
    renderAt('/sessions');
    await screen.findByText('WhatsApp 0/1');
    fireEvent.click(screen.getByRole('button', { name: 'Nova sessão' }));
    const picker = await screen.findByRole('dialog');
    expect(picker).toHaveTextContent('Onde você quer postar suas ofertas?');
    fireEvent.click(screen.getByRole('button', { name: 'WhatsApp' }));
    expect(await screen.findByText('criar')).toBeInTheDocument();
  });
});
