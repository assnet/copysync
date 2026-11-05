import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { OfferConfigResponse, SessionGroupWithSession, SessionItem } from '@/types/api.types';
import { PrivacyProvider } from '@/features/privacy';
import { ConfigGroupsStep } from './ConfigGroupsStep';

const groups: SessionGroupWithSession[] = [
  { groupJid: 'g1', title: 'Promo Bairro', avatarUrl: null, conversationId: 'c1', sessionId: 's1', canPost: true },
];

vi.mock('../../hooks/useSessionGroups', () => ({
  useSessionGroups: () => ({ items: groups, partial: false, loading: false, failed: false, retry: vi.fn() }),
}));

const sessions = [
  { id: 's1', name: 'Alfa', engine: 'BAILEYS', status: 'CONNECTED', avatarUrl: null },
  { id: 's2', name: 'Beta', engine: 'BAILEYS', status: 'CONNECTED', avatarUrl: null },
] as unknown as SessionItem[];
const limits: OfferConfigResponse['limits'] = {
  whatsapp: { sessions: null, broadcastGroups: null },
  telegram: { sessions: null, broadcastGroups: null },
};

const renderStep = () =>
  render(
    <PrivacyProvider>
      <ConfigGroupsStep sessions={sessions} selected={new Map()} limits={limits} catalog={null} onToggle={vi.fn()} onClear={vi.fn()} />
    </PrivacyProvider>,
  );

/** Iniciais "PB" ficam no Avatar do grupo. */
const groupAvatar = () => screen.getByText('PB').closest('.MuiAvatar-root') as HTMLElement;
/** Inicial "A" fica no Avatar do chip de filtro da sessão. */
const sessionAvatar = () => screen.getByText('A').closest('.MuiAvatar-root') as HTMLElement;

describe('privacidade no passo Grupos', () => {
  beforeEach(() => { sessionStorage.clear(); localStorage.clear(); });

  it('foto do grupo borra com offers.groupAvatars', () => {
    localStorage.setItem('privacy.blur', JSON.stringify(['offers.groupAvatars']));
    renderStep();
    expect(getComputedStyle(groupAvatar()).filter).toBe('blur(5px)');
    expect(getComputedStyle(sessionAvatar()).filter).not.toBe('blur(5px)');
  });

  it('avatar da sessão no filtro borra com offers.sessionName', () => {
    localStorage.setItem('privacy.blur', JSON.stringify(['offers.sessionName']));
    renderStep();
    expect(getComputedStyle(sessionAvatar()).filter).toBe('blur(5px)');
    expect(getComputedStyle(groupAvatar()).filter).not.toBe('blur(5px)');
  });

  it('sem flag nada borra', () => {
    renderStep();
    expect(getComputedStyle(groupAvatar()).filter).not.toBe('blur(5px)');
    expect(getComputedStyle(sessionAvatar()).filter).not.toBe('blur(5px)');
  });
});
