import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { OfferConfigGroup, OfferConfigResponse, OfferConfigSettings, SaveOfferConfigRequest, SessionItem } from '@/types/api.types';
import type { SelectedGroup } from './ConfigGroupsStep';
import { OfferConfigWizard } from './OfferConfigWizard';
import { offerStrings } from '../../strings';

// Passos reduzidos ao mínimo: o teste mira o que o assistente envia ao salvar
vi.mock('./ConfigSessionStep', () => ({
  ConfigSessionStep: ({ onToggle }: { onToggle: (id: string) => void }) => (
    <button type="button" onClick={() => onToggle('live')}>marcar sessão</button>
  ),
}));
vi.mock('./ConfigGroupsStep', () => ({
  ConfigGroupsStep: ({ selected, onToggle }: { selected: ReadonlyMap<string, SelectedGroup>; onToggle: (id: string, g: SelectedGroup) => void }) => (
    <div>
      <span data-testid="selected">{[...selected.keys()].join(',')}</span>
      <button type="button" onClick={() => onToggle('n1', { title: 'n1', avatarUrl: null, sessionId: 'live' })}>marcar n1</button>
    </div>
  ),
}));
vi.mock('./ConfigScheduleStep', () => ({ ConfigScheduleStep: () => null }));
vi.mock('./ConfigConfirmStep', () => ({
  ConfigConfirmStep: ({ groups }: { groups: { id: string }[] }) => <span data-testid="confirm">{groups.map((g) => g.id).join(',')}</span>,
}));
vi.mock('@/features/broadcastGroups/hooks/useBroadcastGroups', () => ({
  useBroadcastGroups: () => ({ data: null, loading: false, failed: false, removing: null, reload: vi.fn(), remove: vi.fn() }),
}));

const live = { id: 'live', name: 'Nova', engine: 'BAILEYS', status: 'CONNECTED', avatarUrl: null } as unknown as SessionItem;
const limits: OfferConfigResponse['limits'] = {
  whatsapp: { sessions: 2, broadcastGroups: 40 },
  telegram: { sessions: 2, broadcastGroups: 40 },
};
// Configuração salva aponta para uma sessão que foi apagada (não vem mais na lista de sessões)
const config: OfferConfigSettings = {
  sessionIds: ['dead'], intervalMinSeconds: 60, intervalMaxSeconds: 120, dispatchOrder: 'SEQUENTIAL',
  windowStartMinute: 0, windowEndMinute: 1440, weekdays: [0, 1, 2, 3, 4, 5, 6],
};
const oldGroup = (id: string): OfferConfigGroup =>
  ({ conversationId: id, title: id, avatarUrl: null, sessionId: 'dead', canPost: null, postBlockedReason: null });

const renderWizard = (onSave: (body: SaveOfferConfigRequest) => Promise<OfferConfigResponse>, sessions: SessionItem[] = [live]) =>
  render(
    <OfferConfigWizard
      config={config} groups={['old1', 'old2'].map(oldGroup)} limits={limits} crossSessionDispatch sessions={sessions}
      sessionsLoading={false} sessionsFailed={false} onRetrySessions={vi.fn()} onSave={onSave} onSaved={vi.fn()}
    />,
  );
const next = () => fireEvent.click(screen.getByRole('button', { name: 'Continuar' }));

describe('assistente do gerador: grupos de sessão que saiu do envio', () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
  });

  it('não envia nem conta grupos da sessão apagada da configuração anterior', async () => {
    const onSave = vi.fn().mockResolvedValue({} as OfferConfigResponse);
    renderWizard(onSave);
    fireEvent.click(screen.getByText('marcar sessão'));
    next();
    expect(screen.getByTestId('selected').textContent).toBe('');
    fireEvent.click(screen.getByText('marcar n1'));
    next();
    next();
    expect(screen.getByTestId('confirm').textContent).toBe('n1');
    fireEvent.click(screen.getByRole('button', { name: offerStrings.wizard.save }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0]![0]).toMatchObject({ sessionIds: ['live'], conversationIds: ['n1'] });
  });

  it('só os grupos antigos (sessão apagada) não liberam "Continuar" no passo Grupos', () => {
    renderWizard(vi.fn());
    fireEvent.click(screen.getByText('marcar sessão'));
    next();
    expect((screen.getByRole('button', { name: 'Continuar' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('404 ao salvar mostra texto próprio, não o genérico', async () => {
    const onSave = vi.fn().mockRejectedValue({ code: 'NOT_FOUND', message: offerStrings.errors.generic, action: 'none', isLinkField: false });
    renderWizard(onSave);
    fireEvent.click(screen.getByText('marcar sessão'));
    next();
    fireEvent.click(screen.getByText('marcar n1'));
    next();
    next();
    fireEvent.click(screen.getByRole('button', { name: offerStrings.wizard.save }));
    expect(await screen.findByText(offerStrings.wizard.saveNotFound)).toBeTruthy();
    expect(screen.queryByText(offerStrings.errors.generic)).toBeNull();
  });
});
