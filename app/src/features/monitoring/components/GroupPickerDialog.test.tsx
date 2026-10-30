import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { PrivacyProvider } from '@/features/privacy';
import type { SessionItem } from '@/types/api.types';

const listSessionGroups = vi.fn();
vi.mock('@/services/offer.service', () => ({ offerService: { listSessionGroups: (id: string, q?: string) => listSessionGroups(id, q) } }));

import { GroupPickerDialog, type PickedGroup, KEYWORDS_PER_GROUP, KEYWORD_MAX_LENGTH, normalizeKeywords } from './GroupPickerDialog';
import { canRetryCaptured } from './CapturedOffersList';

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
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

describe('GroupPickerDialog — busca, bloqueio e privacidade', () => {
  const base = { sessionId: 's1', initial: [] as PickedGroup[], max: 5, onSave: async () => undefined };

  it('busca persiste na aba e é limpa ao cancelar', async () => {
    const onClose = vi.fn();
    const { unmount } = render(<GroupPickerDialog {...base} mode="monitored" excludeJids={[]} onClose={onClose} />);
    fireEvent.change(screen.getByLabelText('Buscar grupo'), { target: { value: 'promo' } });
    unmount();
    render(<GroupPickerDialog {...base} mode="monitored" excludeJids={[]} onClose={onClose} />);
    expect(screen.getByLabelText('Buscar grupo')).toHaveValue('promo');
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(onClose).toHaveBeenCalled();
    expect(sessionStorage.getItem('ui.monitoring.picker.search.monitored.s1')).toBeNull();
  });

  it('lista completa (nome dos selecionados) é buscada uma vez, mesmo alternando a busca', async () => {
    vi.useFakeTimers();
    try {
      render(<GroupPickerDialog {...base} mode="monitored" excludeJids={[]} onClose={() => undefined} />);
      await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
      const input = screen.getByLabelText('Buscar grupo');
      for (const q of ['a', '', 'b', '', 'c']) {
        fireEvent.change(input, { target: { value: q } });
        await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
      }
      const full = listSessionGroups.mock.calls.filter((c) => c[1] === undefined);
      // 1 da lista principal ao abrir + 1 do lookup na 1ª busca + 2 da lista principal ao limpar
      expect(full).toHaveLength(4);
      expect(listSessionGroups.mock.calls.filter((c) => c[1] !== undefined)).toHaveLength(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it('motivo de bloqueio visível sem hover', async () => {
    listSessionGroups.mockResolvedValue({ groups: [{ groupJid: 'g1', title: 'Rival', avatarUrl: null }], partial: false });
    render(<GroupPickerDialog {...base} mode="monitored" excludeJids={['g1']} onClose={() => undefined} />);
    expect(await screen.findByText(/Já é grupo de disparo/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Adicionar Rival' })).toBeDisabled();
  });

  it('nome da sessão é borrado com a flag', async () => {
    localStorage.setItem('privacy.blur', JSON.stringify(['monitoring.sessionName']));
    listSessionGroups.mockImplementation(async (id: string) => ({ groups: [{ groupJid: `g-${id}`, title: `Grupo ${id}`, avatarUrl: null }], partial: false }));
    const sessions = (['s1', 's2'] as const).map((id): SessionItem => ({
      id, tenantId: 't', name: id === 's1' ? 'Loja' : 'Suporte', engine: 'baileys', phone: null, externalRef: null, status: 'CONNECTED',
      lastConnectedAt: null, lastDisconnectedAt: null, lastSeenAt: null, createdAt: '', updatedAt: '',
    }));
    render(
      <PrivacyProvider>
        <MemoryRouter>
          <GroupPickerDialog {...base} mode="broadcast" max={null} excludeJids={[]} sessions={sessions} crossSession onClose={() => undefined} />
        </MemoryRouter>
      </PrivacyProvider>,
    );
    const name = await screen.findByText('Suporte');
    expect(name.closest('[data-blurred="true"]')).not.toBeNull();
    expect(screen.getByText('Grupo s2').closest('[data-blurred="true"]')).toBeNull();
  });
});

describe('GroupPickerDialog — rascunho após reload', () => {
  it('grupo adicionado no rascunho recupera nome pela lista da sessão, mesmo com busca salva', async () => {
    // Rascunho e busca vindos de um reload: só jid + palavras-chave, sem nome/foto
    sessionStorage.setItem('ui.monitoring.picker.monitored.s1', JSON.stringify({ v: 3, d: [{ groupJid: 'g9', sessionId: 's1', keywords: [] }] }));
    sessionStorage.setItem('ui.monitoring.picker.search.monitored.s1', JSON.stringify({ v: 0, d: 'xyz' }));
    listSessionGroups.mockImplementation(async (_id: string, q?: string) =>
      ({ groups: q ? [] : [{ groupJid: 'g9', title: 'Grupo Recuperado', avatarUrl: null }], partial: false }));
    render(<GroupPickerDialog mode="monitored" sessionId="s1" initial={[]} max={5} excludeJids={[]} onClose={() => undefined} onSave={async () => undefined} />);
    expect(await screen.findByText('Grupo Recuperado')).toBeInTheDocument();
    expect(sessionStorage.getItem('ui.monitoring.picker.monitored.s1')).not.toContain('Grupo Recuperado');
  });

  it('bloqueados vão para o fim e o avatar não mostra iniciais com nomes borrados', async () => {
    localStorage.setItem('privacy.blur', JSON.stringify(['monitoring.groupNames']));
    listSessionGroups.mockResolvedValue({
      groups: [{ groupJid: 'g1', title: 'Zeta Bloqueado', avatarUrl: null }, { groupJid: 'g2', title: 'Alfa Livre', avatarUrl: null }],
      partial: false,
    });
    render(
      <PrivacyProvider>
        <GroupPickerDialog mode="monitored" sessionId="s1" initial={[]} max={5} excludeJids={['g1']} onClose={() => undefined} onSave={async () => undefined} />
      </PrivacyProvider>,
    );
    const free = await screen.findByText('Alfa Livre');
    const locked = screen.getByText('Zeta Bloqueado');
    expect(free.compareDocumentPosition(locked) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByText('AL')).toBeNull();
    expect(screen.queryByText('ZB')).toBeNull();
  });
});
