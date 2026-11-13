import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import type { SessionItem } from '@/types/api.types';
import { readPersisted, writePersisted } from '@/hooks/usePersistedState';
import { offerHunterStrings } from '../../strings';
import { DestinationPickerDialog, type DestinationPickerDialogProps } from './DestinationPickerDialog';

const offers = vi.hoisted(() => ({ listSessionGroups: vi.fn() }));
vi.mock('@/services/offer.service', () => ({ offerService: offers }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }));
vi.mock('@/contexts/TenantContext', () => ({ useTenant: () => ({ activeTenantId: 't1', tenants: [] }) }));

const KEY = 'offerHunter.destinationDraft@t1:u1';
const OPTS = { scope: 'tab' as const, version: 1 };
type Draft = { sessionId: string | null; conversationId: string | null; search: string };
const draft = () => readPersisted<Draft>(KEY, OPTS);
const session = (id: string): SessionItem => ({ id, tenantId: 't1', name: `Sessão ${id}`, status: 'CONNECTED' } as SessionItem);
const group = (conversationId: string) => ({ groupJid: `${conversationId}@g.us`, title: `Grupo ${conversationId}`, avatarUrl: null, conversationId });

const props = (over: Partial<DestinationPickerDialogProps> = {}): DestinationPickerDialogProps => ({
  open: true, current: null, sessions: [session('s1')], sessionsLoading: false, sessionsFailed: false,
  onRetrySessions: vi.fn(), onClose: vi.fn(), onSave: vi.fn().mockResolvedValue(undefined), ...over,
});
const saveButton = () => screen.getByRole('button', { name: offerHunterStrings.destination.save });

beforeEach(() => {
  sessionStorage.clear();
  vi.clearAllMocks();
  offers.listSessionGroups.mockResolvedValue({ groups: [group('c1')], partial: false });
});

describe('DestinationPickerDialog: rascunho de outro tenant', () => {
  it('sessão que não é do tenant é descartada só depois de carregar as sessões', async () => {
    writePersisted<Draft>(KEY, { sessionId: 'alheia', conversationId: 'cx', search: '' }, OPTS);
    const { rerender } = render(<DestinationPickerDialog {...props({ sessions: [], sessionsLoading: true })} />);
    expect(draft()?.sessionId).toBe('alheia');
    rerender(<DestinationPickerDialog {...props()} />);
    await waitFor(() => expect(draft()).toEqual({ sessionId: null, conversationId: null, search: '' }));
    expect(offers.listSessionGroups).not.toHaveBeenCalledWith('alheia', undefined);
  });

  it('grupo que não está entre os da sessão é descartado após carregar os grupos', async () => {
    let resolve!: (v: unknown) => void;
    offers.listSessionGroups.mockImplementationOnce(() => new Promise((r) => { resolve = r; }));
    writePersisted<Draft>(KEY, { sessionId: 's1', conversationId: 'alheio', search: '' }, OPTS);
    render(<DestinationPickerDialog {...props()} />);
    await waitFor(() => expect(offers.listSessionGroups).toHaveBeenCalledWith('s1', undefined));
    expect(draft()?.conversationId).toBe('alheio');
    resolve({ groups: [group('c1')], partial: false });
    await waitFor(() => expect(draft()).toEqual({ sessionId: 's1', conversationId: null, search: '' }));
    expect(saveButton()).toBeDisabled();
  });

  it('rascunho válido do tenant fica', async () => {
    writePersisted<Draft>(KEY, { sessionId: 's1', conversationId: 'c1', search: '' }, OPTS);
    render(<DestinationPickerDialog {...props()} />);
    expect(await screen.findByText('Grupo c1')).toBeInTheDocument();
    expect(draft()).toEqual({ sessionId: 's1', conversationId: 'c1', search: '' });
    expect(saveButton()).toBeEnabled();
  });
});
