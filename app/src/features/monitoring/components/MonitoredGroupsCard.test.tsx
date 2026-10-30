import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithTheme } from '@/test/renderWithTheme';
import { PrivacyProvider } from '@/features/privacy';
import { MonitoredGroupsCard } from './MonitoredGroupsCard';

const groups = [{ conversationId: 'c1', groupJid: 'g1', title: 'Promo Rival', avatarUrl: null, keywords: ['fone', 'notebook gamer', 'tv'] }];

describe('MonitoredGroupsCard', () => {
  it('palavras-chave viram contagem (sem cortar) e uso diz "no plano"', () => {
    renderWithTheme(<MonitoredGroupsCard groups={groups} used={3} max={40} onConfigure={() => undefined} />);
    expect(screen.getByText('3 palavras-chave')).toBeInTheDocument();
    expect(screen.getByRole('group', { name: /Palavras-chave de Promo Rival: fone, notebook gamer, tv/ })).toBeInTheDocument();
    expect(screen.getByText('3/40 no plano')).toBeInTheDocument();
  });

  it('nomes borrados: avatar não mostra as iniciais do grupo', () => {
    localStorage.setItem('privacy.blur', JSON.stringify(['monitoring.groupNames']));
    renderWithTheme(<PrivacyProvider><MonitoredGroupsCard groups={groups} used={1} max={5} onConfigure={() => undefined} /></PrivacyProvider>);
    expect(screen.queryByText('PR')).toBeNull();
    localStorage.clear();
  });
});
