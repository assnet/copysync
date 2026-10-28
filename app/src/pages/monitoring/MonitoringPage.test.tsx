import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import type { CapturedOffersResponse, GroupMonitorConfigResponse, SessionItem } from '@/types/api.types';

const listSessions = vi.fn();
const getConfig = vi.fn();
const saveSettings = vi.fn();
const listCaptured = vi.fn();
const retryCaptured = vi.fn();
vi.mock('@/services/session.service', () => ({ sessionService: { list: () => listSessions() } }));
vi.mock('@/services/monitoring.service', () => ({
  monitoringService: {
    getConfig: (id: string) => getConfig(id),
    saveSettings: (b: unknown) => saveSettings(b),
    saveMonitoredGroups: vi.fn(),
    saveBroadcastGroups: vi.fn(),
    listCaptured: (id: string, c?: string) => listCaptured(id, c),
    retryCaptured: (id: string) => retryCaptured(id),
  },
}));
vi.mock('@/features/sendQueue/components/SendQueuePanel', () => ({ SendQueuePanel: ({ sessionId }: { sessionId: string }) => <div>fila {sessionId}</div> }));

import { MonitoringPage } from './MonitoringPage';

const session = (id: string, name: string): SessionItem => ({
  id, tenantId: 't', name, engine: 'baileys', phone: '5511999990000', externalRef: null, status: 'CONNECTED',
  lastConnectedAt: null, lastDisconnectedAt: null, lastSeenAt: null, createdAt: '', updatedAt: '',
});

const config = (sessionId: string): GroupMonitorConfigResponse => ({
  sessionId,
  settings: {
    enabled: false, windowStartMinute: 0, windowEndMinute: 1440, intervalMinSeconds: 300, intervalMaxSeconds: 600,
    startDelaySeconds: 0, maxOfferAgeMinutes: 240, couponMaxAgeMinutes: 60, mentionAll: false, simulateTyping: true, typingSeconds: 5,
    textMode: 'ORIGINAL', audience: 'STANDARD', enrichLinkOnly: true,
  },
  monitoredGroups: [{ conversationId: 'c1', groupJid: 'g1@g.us', title: 'Promo Rival', avatarUrl: null, keywords: ['fone'] }],
  broadcastGroups: [{ conversationId: 'c2', groupJid: 'g2@g.us', sessionId, title: 'Meu Grupo', avatarUrl: null, position: 0 }],
  limits: { monitoredGroups: 5, broadcastGroups: 10, mentionAllEnabled: false, crossSessionDispatch: false },
  usage: { monitoredGroups: 1, broadcastGroups: 1 },
});

const captured: CapturedOffersResponse = {
  items: [{
    id: 'o1', status: 'SKIPPED', reason: 'CREDENTIAL_MISSING', marketplace: 'SHOPEE', sourceGroupTitle: 'Promo Rival',
    sourceGroupAvatarUrl: null, textPreview: 'Fone bluetooth por R$ 50', imageUrl: null, coupon: 'DESC10', affiliateUrl: null,
    offerId: null, textSource: null, aiErrorCode: null, offerStatus: null, sentCount: 0, totalCount: 0, capturedAt: new Date().toISOString(), expiresAt: null, startsAt: null, imageUnavailable: true,
  }],
  nextCursor: 'next',
};

function Where() {
  const loc = useLocation();
  return <div data-testid="where">{loc.pathname + loc.search}</div>;
}

const renderAt = (url = '/monitoring') =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/monitoring" element={<><MonitoringPage /><Where /></>} />
        <Route path="/settings/sessions" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );

beforeEach(() => {
  sessionStorage.clear();
  listSessions.mockReset();
  getConfig.mockReset();
  saveSettings.mockReset();
  listCaptured.mockReset();
  retryCaptured.mockReset();
  listSessions.mockResolvedValue({ sessions: [session('s1', 'Loja A'), session('s2', 'Loja B')], total: 2 });
  getConfig.mockImplementation(async (id: string) => config(id));
  listCaptured.mockResolvedValue(captured);
});

describe('MonitoringPage', () => {
  it('mostra os três cards, a configuração e as ofertas capturadas da 1ª sessão', async () => {
    renderAt();
    expect(await screen.findByText('Meu Grupo')).toBeInTheDocument();
    expect(getConfig).toHaveBeenCalledWith('s1');
    expect(screen.getAllByText('Promo Rival').length).toBeGreaterThan(0);
    expect(screen.getByText('Sem restrição — envio 24 h')).toBeInTheDocument();
    expect(screen.getByText('Falta a sua credencial de afiliado desta loja')).toBeInTheDocument();
    expect(screen.getByText('Imagem indisponível')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tentar de novo' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Carregar mais' })).toBeInTheDocument();
    expect(screen.getByText('fila s1')).toBeInTheDocument();
  });

  it('?sessionId= escolhe a sessão e sai da URL', async () => {
    renderAt('/monitoring?sessionId=s2');
    expect(await screen.findByText('fila s2')).toBeInTheDocument();
    expect(getConfig).toHaveBeenCalledWith('s2');
    expect(screen.getByTestId('where')).toHaveTextContent(/^\/monitoring$/);
  });

  it('alterar e salvar envia a configuração e some com a barra de rascunho', async () => {
    saveSettings.mockImplementation(async (b: { sessionId: string }) => ({ ...config(b.sessionId), settings: { ...config(b.sessionId).settings, enabled: true } }));
    renderAt();
    fireEvent.click(await screen.findByRole('checkbox', { name: /Monitoramento ativo/ }));
    const bar = await screen.findByText('Alterações não salvas');
    fireEvent.click(within(bar.parentElement!).getByRole('button', { name: 'Salvar' }));
    expect(await screen.findByText('Configuração salva.')).toBeInTheDocument();
    expect(saveSettings).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 's1', enabled: true, windowStartMinute: 0, windowEndMinute: 1440 }));
    expect(screen.queryByText('Alterações não salvas')).not.toBeInTheDocument();
  });

  it('"Conectar nova sessão" vai para o assistente com returnTo', async () => {
    renderAt();
    fireEvent.click(await screen.findByRole('button', { name: 'Conectar nova sessão' }));
    expect(screen.getByTestId('where')).toHaveTextContent('/settings/sessions?create=1&returnTo=/monitoring');
  });
});
