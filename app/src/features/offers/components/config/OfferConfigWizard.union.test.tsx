import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { BroadcastGroupsResponse, OfferConfigGroup, OfferConfigResponse, OfferConfigSettings, SessionItem } from '@/types/api.types';
import type { SelectedGroup } from './ConfigGroupsStep';
import { OfferConfigWizard } from './OfferConfigWizard';

// Passos reduzidos a botões: o teste mira só a validação do assistente
vi.mock('./ConfigSessionStep', () => ({ ConfigSessionStep: () => null }));
vi.mock('./ConfigGroupsStep', () => ({
  ConfigGroupsStep: ({ selected, catalog: cat, onToggle }: {
    selected: ReadonlyMap<string, SelectedGroup>; catalog: BroadcastGroupsResponse | null; onToggle: (id: string, g: SelectedGroup) => void;
  }) => (
    <div>
      <span data-testid="selected">{[...selected.keys()].sort().join(',')}</span>
      <span data-testid="catalog">{cat ? String(cat.items.length) : 'none'}</span>
      {['n1', 'n2', 'm1'].map((id) => (
        <button key={id} type="button" onClick={() => onToggle(id, { title: id, avatarUrl: null, sessionId: 's1' })}>{`marcar ${id}`}</button>
      ))}
    </div>
  ),
}));

const used = (id: string, usedBy: BroadcastGroupsResponse['items'][number]['usedBy']) =>
  ({ conversationId: id, sessionId: 's1', channel: 'whatsapp' as const, title: null, avatarUrl: null, usedBy });
// 3 no gerador + 6 só no monitoramento = 9 em uso pela união
let catalog: BroadcastGroupsResponse | null = null;
const hookCalls = vi.fn();
vi.mock('@/features/broadcastGroups/hooks/useBroadcastGroups', () => ({
  useBroadcastGroups: () => { hookCalls(); return { data: catalog, loading: false, failed: false, removing: null, reload: vi.fn(), remove: vi.fn() }; },
}));

const session = { id: 's1', name: 'Sessão', engine: 'BAILEYS', status: 'CONNECTED', avatarUrl: null } as unknown as SessionItem;
const limits: OfferConfigResponse['limits'] = {
  whatsapp: { sessions: null, broadcastGroups: 10 },
  telegram: { sessions: null, broadcastGroups: null },
};
const config: OfferConfigSettings = {
  sessionIds: ['s1'], intervalMinSeconds: 60, intervalMaxSeconds: 120, dispatchOrder: 'SEQUENTIAL',
  windowStartMinute: 0, windowEndMinute: 1440, weekdays: [0, 1, 2, 3, 4, 5, 6],
};
const group = (id: string): OfferConfigGroup =>
  ({ conversationId: id, title: id, avatarUrl: null, sessionId: 's1', canPost: true, postBlockedReason: null });

const renderAtGroups = (saved: string[]) => {
  render(
    <OfferConfigWizard
      config={config} groups={saved.map(group)} limits={limits} crossSessionDispatch sessions={[session]}
      sessionsLoading={false} sessionsFailed={false} onRetrySessions={vi.fn()} onSave={vi.fn()} onSaved={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Continuar' }));
};
const next = () => screen.getByRole('button', { name: 'Continuar' }) as HTMLButtonElement;
const selectedIds = () => screen.getByTestId('selected').textContent;

describe('assistente do gerador valida o limite pela união', () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    catalog = {
      items: [
        ...['g1', 'g2', 'g3'].map((id) => used(id, ['generator'])),
        ...['m1', 'm2', 'm3', 'm4', 'm5', 'm6'].map((id) => used(id, ['monitor:s1'])),
      ],
      limits: { whatsapp: { broadcastGroups: 10 }, telegram: { broadcastGroups: null } },
      usage: { whatsapp: { broadcastGroups: 9 }, telegram: { broadcastGroups: 0 } },
    } as BroadcastGroupsResponse;
  });

  it('9 em uso e limite 10: marcar 2 novos aceita o 1º e bloqueia o 2º', () => {
    renderAtGroups(['g1', 'g2', 'g3']);
    fireEvent.click(screen.getByText('marcar n1'));
    fireEvent.click(screen.getByText('marcar n2'));
    expect(selectedIds()).toBe('g1,g2,g3,n1');
    expect(next().disabled).toBe(false);
  });

  it('grupo já em uso não conta de novo: no limite, ainda marca', () => {
    renderAtGroups(['g1', 'g2', 'g3']);
    fireEvent.click(screen.getByText('marcar n1'));
    fireEvent.click(screen.getByText('marcar m1'));
    expect(selectedIds()).toBe('g1,g2,g3,m1,n1');
    expect(next().disabled).toBe(false);
  });

  it('rascunho acima do limite pela união desabilita "Continuar"', () => {
    // 9 em uso + n1 e n2 salvos fora do catálogo = 11 > 10 (só o rascunho seriam 5)
    renderAtGroups(['g1', 'g2', 'g3', 'n1', 'n2']);
    expect(next().disabled).toBe(true);
  });

  it('sem catálogo: conta só o rascunho (comportamento antigo)', () => {
    catalog = null;
    renderAtGroups(['g1', 'g2', 'g3', 'n1', 'n2']);
    fireEvent.click(screen.getByText('marcar m1'));
    expect(selectedIds()).toBe('g1,g2,g3,m1,n1,n2');
    expect(next().disabled).toBe(false);
    expect(screen.getByTestId('catalog').textContent).toBe('none');
  });

  it('catálogo do assistente chega ao passo Grupos por prop', () => {
    renderAtGroups(['g1']);
    expect(screen.getByTestId('catalog').textContent).toBe('9');
    expect(hookCalls).toHaveBeenCalled();
  });

  it('Confirmar mostra o horário escolhido junto do resumo', () => {
    localStorage.clear();
    sessionStorage.clear();
    render(
      <OfferConfigWizard
        config={{ ...config, windowStartMinute: 480, windowEndMinute: 1320, weekdays: [1, 2, 3, 4, 5] }}
        groups={[group('g1')]} limits={limits} crossSessionDispatch sessions={[session]}
        sessionsLoading={false} sessionsFailed={false} onRetrySessions={vi.fn()} onSave={vi.fn()} onSaved={vi.fn()}
      />,
    );
    for (let i = 0; i < 3; i++) fireEvent.click(screen.getByRole('button', { name: 'Continuar' }));
    expect(screen.getByText('Horário de postagem')).toBeTruthy();
    expect(screen.getByText('08:00 → 22:00 · 14 h')).toBeTruthy();
    expect(screen.getByText('· Segunda a sexta')).toBeTruthy();
  });
});
