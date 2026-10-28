import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { SessionItem } from '@/types/api.types';

const listSessionGroups = vi.fn();
vi.mock('@/services/offer.service', () => ({ offerService: { listSessionGroups: (id: string, q?: string) => listSessionGroups(id, q) } }));

import { GroupPickerDialog, KEYWORDS_PER_GROUP, KEYWORD_MAX_LENGTH, normalizeKeywords } from './GroupPickerDialog';
import { canRetryCaptured } from './CapturedOffersList';

beforeEach(() => {
  sessionStorage.clear();
  listSessionGroups.mockReset();
  listSessionGroups.mockResolvedValue({ groups: [], partial: false });
});

describe('normalizeKeywords', () => {
  it('corta no tamanho e na quantidade da API, sem repetidas', () => {
    const long = 'x'.repeat(60);
    expect(normalizeKeywords([` ${long} `])[0]).toHaveLength(KEYWORD_MAX_LENGTH);
    expect(normalizeKeywords(['Fone', 'fone', ' '])).toEqual(['Fone']);
    expect(normalizeKeywords(Array.from({ length: 30 }, (_, i) => `k${i}`))).toHaveLength(KEYWORDS_PER_GROUP);
  });
});

describe('GroupPickerDialog', () => {
  it('rascunho da aba guarda só groupJid e palavras-chave (sem nome/foto do servidor)', async () => {
    render(
      <GroupPickerDialog
        mode="monitored"
        sessionId="s1"
        initial={[{ groupJid: 'g1@g.us', sessionId: 's1', title: 'Promo Rival', avatarUrl: 'https://x/a.jpg', keywords: ['fone'] }]}
        max={5}
        excludeJids={[]}
        onClose={() => undefined}
        onSave={async () => undefined}
      />,
    );
    expect(await screen.findByText('Promo Rival')).toBeInTheDocument();
    expect(screen.getByText('1/20 palavras-chave')).toBeInTheDocument();
    const raw = sessionStorage.getItem('ui.monitoring.picker.monitored.s1') ?? '';
    expect(JSON.parse(raw).d).toEqual([{ groupJid: 'g1@g.us', sessionId: 's1', keywords: ['fone'] }]);
    expect(raw).not.toContain('Promo Rival');
  });
});

describe('canRetryCaptured', () => {
  it('aceita os motivos recuperáveis da API, inclusive monitoramento desligado', () => {
    expect(canRetryCaptured({ status: 'SKIPPED', reason: 'MONITOR_DISABLED' })).toBe(true);
    expect(canRetryCaptured({ status: 'FAILED', reason: 'INTERNAL_ERROR' })).toBe(true);
    expect(canRetryCaptured({ status: 'SKIPPED', reason: 'EXPIRED' })).toBe(false);
    expect(canRetryCaptured({ status: 'QUEUED', reason: null })).toBe(false);
  });
});

describe('GroupPickerDialog — sessão cruzada', () => {
  const session = (id: string, name: string): SessionItem => ({
    id, tenantId: 't', name, engine: 'baileys', phone: null, externalRef: null, status: 'CONNECTED',
    lastConnectedAt: null, lastDisconnectedAt: null, lastSeenAt: null, createdAt: '', updatedAt: '',
  });
  const sessions = [session('s1', 'Loja'), session('s2', 'Suporte')];
  const dialog = (crossSession: boolean) => (
    <MemoryRouter>
      <GroupPickerDialog mode="broadcast" sessionId="s1" initial={[]} max={null} excludeJids={[]} sessions={sessions} crossSession={crossSession} onClose={() => undefined} onSave={async () => undefined} />
    </MemoryRouter>
  );

  it('sem a feature: só os grupos da sessão atual e o aviso do plano com link', async () => {
    listSessionGroups.mockResolvedValue({ groups: [{ groupJid: 'g1', title: 'Meu grupo', avatarUrl: null }], partial: false });
    render(dialog(false));
    expect(await screen.findByText('Meu grupo')).toBeInTheDocument();
    expect(listSessionGroups.mock.calls.map((c) => c[0])).toEqual(['s1']);
    expect(screen.getByText(/exclusivo do plano Business/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ver planos' })).toHaveAttribute('href', '/plans');
  });

  it('com a feature: grupos das duas sessões, cada um com o nome da sessão', async () => {
    listSessionGroups.mockImplementation(async (id: string) => ({ groups: [{ groupJid: `g-${id}`, title: `Grupo ${id}`, avatarUrl: null }], partial: false }));
    render(dialog(true));
    expect(await screen.findByText('Grupo s2')).toBeInTheDocument();
    expect(listSessionGroups.mock.calls.map((c) => c[0]).sort()).toEqual(['s1', 's2']);
    expect(screen.getByText('Suporte')).toBeInTheDocument();
    expect(screen.queryByText(/exclusivo do plano Business/)).not.toBeInTheDocument();
  });
});
