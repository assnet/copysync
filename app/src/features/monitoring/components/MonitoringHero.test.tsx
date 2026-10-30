import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';
import { renderWithTheme } from '@/test/renderWithTheme';
import type { GroupMonitorConfigResponse, SessionItem, SessionStatus } from '@/types/api.types';
import { MonitoringHero } from './MonitoringHero';

const session = (status: SessionStatus = 'CONNECTED'): SessionItem => ({
  id: 's1', tenantId: 't', name: 'Loja A', engine: 'baileys', phone: null, externalRef: null, status,
  lastConnectedAt: null, lastDisconnectedAt: null, lastSeenAt: null, createdAt: '', updatedAt: '',
});

const config = (over: Partial<GroupMonitorConfigResponse> = {}, enabled = true): GroupMonitorConfigResponse => ({
  sessionId: 's1',
  settings: {
    enabled, windowStartMinute: 0, windowEndMinute: 1440, intervalMinSeconds: 300, intervalMaxSeconds: 600,
    startDelaySeconds: 0, maxOfferAgeMinutes: 240, couponMaxAgeMinutes: 60, mentionAll: false, simulateTyping: true, typingSeconds: 5,
    textMode: 'ORIGINAL', audience: 'STANDARD', enrichLinkOnly: true, captureOutsideWindow: true,
  },
  monitoredGroups: [
    { conversationId: 'c1', groupJid: 'g1@g.us', title: 'A', avatarUrl: null, keywords: [] },
    { conversationId: 'c3', groupJid: 'g3@g.us', title: 'B', avatarUrl: null, keywords: [] },
  ],
  broadcastGroups: [{ conversationId: 'c2', groupJid: 'g2@g.us', sessionId: 's1', title: 'C', avatarUrl: null, position: 0 }],
  limits: { monitoredGroups: 5, broadcastGroups: 10, mentionAllEnabled: false, crossSessionDispatch: false },
  usage: { monitoredGroups: 2, broadcastGroups: 1 },
  credentialAlerts: [],
  ...over,
});

const steps = () => screen.getByRole('list', { name: 'O que falta para o monitoramento funcionar' });

describe('MonitoringHero', () => {
  it.each(['light', 'dark'] as const)('%s: tudo pronto e ligado → "Ativo" e contagens nas etapas', (mode) => {
    renderWithTheme(<MonitoringHero session={session()} config={config()} onAction={vi.fn()} actions={null} />, mode);
    expect(screen.getByRole('heading', { level: 1, name: 'Monitoramento' })).toBeInTheDocument();
    expect(screen.getByRole('status', { name: /Ativo/ })).toBeInTheDocument();
    const list = steps();
    expect(within(list).getByText('2 grupos monitorados')).toBeInTheDocument();
    expect(within(list).getByText('1 grupo de disparo')).toBeInTheDocument();
    expect(within(list).getByText('Credenciais em dia')).toBeInTheDocument();
    expect(within(list).queryByRole('button')).toBeNull();
  });

  it('tudo pronto e desligado → "Desligado"', () => {
    renderWithTheme(<MonitoringHero session={session()} config={config({}, false)} onAction={vi.fn()} actions={null} />);
    expect(screen.getByRole('status', { name: /Desligado/ })).toBeInTheDocument();
  });

  it('falta grupo de disparo → "Falta configurar"; etapa pendente é botão e chama a ação', () => {
    const onAction = vi.fn();
    renderWithTheme(<MonitoringHero session={session()} config={config({ broadcastGroups: [] })} onAction={onAction} actions={null} />);
    expect(screen.getByRole('status', { name: /Falta configurar/ })).toBeInTheDocument();
    const btn = within(steps()).getByRole('button', { name: /Escolher grupos de disparo/ });
    expect(btn.closest('li')).toHaveAttribute('aria-current', 'step');
    fireEvent.click(btn);
    expect(onAction).toHaveBeenCalledWith('broadcast');
  });

  it('credencial com problema vira etapa de atenção que leva aos avisos', () => {
    const onAction = vi.fn();
    renderWithTheme(
      <MonitoringHero
        session={session()}
        config={config({ credentialAlerts: [{ provider: 'SHOPEE', kind: 'MISSING', since: null, code: null }] })}
        onAction={onAction}
        actions={null}
      />,
    );
    fireEvent.click(within(steps()).getByRole('button', { name: /1 loja sem credencial válida/ }));
    expect(onAction).toHaveBeenCalledWith('credentials');
  });

  it('sem sessão: sem etapas nem status', () => {
    renderWithTheme(<MonitoringHero session={null} config={null} onAction={vi.fn()} actions={null} />);
    expect(screen.queryByRole('list')).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
  });
});

describe('MonitoringHero — desligado', () => {
  it('status lido pelo texto e "Ligar" chama onEnable', () => {
    const onEnable = vi.fn();
    renderWithTheme(<MonitoringHero session={session()} config={config({}, false)} onAction={vi.fn()} onEnable={onEnable} actions={null} />);
    expect(screen.getByRole('status')).toHaveTextContent('Status do monitoramento: Desligado');
    fireEvent.click(screen.getByRole('button', { name: 'Ligar' }));
    expect(onEnable).toHaveBeenCalled();
  });
});
