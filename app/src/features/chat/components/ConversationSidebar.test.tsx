import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithTheme } from '@/test/renderWithTheme';
import { ConversationSidebar } from './ConversationSidebar';
import type { ChatConversation, ConversationFilter } from '../types';

function makeConversation(overrides: Partial<ChatConversation> = {}): ChatConversation {
  return {
    id: 'conv-1',
    contact: { id: 'c1', name: 'Geovana Silvestre', phone: '554499881234', initials: 'GS', avatarColor: '#7c3aed' },
    session: { id: 'sess-1', name: 'Sessão 1', phone: '554774003804' },
    status: 'open',
    unreadCount: 0,
    lastMessage: 'Tudo certo por aqui',
    lastMessageAt: new Date().toISOString(),
    tags: [],
    assignedTo: null,
    notes: '',
    queue: null,
    ...overrides,
  } as ChatConversation;
}

const conversas = [
  makeConversation({ id: 'fav', favorite: true, contact: { id: 'c1', name: 'Ana Marcada', phone: '1', initials: 'F', avatarColor: '#000' } }),
  makeConversation({ id: 'comum', favorite: false, contact: { id: 'c2', name: 'Comum', phone: '2', initials: 'C', avatarColor: '#000' } }),
  makeConversation({ id: 'sem-flag', contact: { id: 'c3', name: 'Sem flag', phone: '3', initials: 'S', avatarColor: '#000' } }),
];

function render(filter: ConversationFilter, onFilterChange = vi.fn(), mode?: 'light' | 'dark') {
  renderWithTheme(
    <ConversationSidebar
      conversations={conversas}
      selectedId={null}
      onSelect={vi.fn()}
      sessions={[]}
      selectedSessionId={null}
      onSessionChange={vi.fn()}
      search=""
      onSearchChange={vi.fn()}
      filter={filter}
      onFilterChange={onFilterChange}
    />,
    mode,
  );
  return onFilterChange;
}

describe('ConversationSidebar — filtro Favoritas', () => {
  it('oferece o chip Favoritas com a contagem de conversas favoritas', async () => {
    const onFilterChange = render('all');

    await userEvent.click(screen.getByText('Favoritas 1'));

    expect(onFilterChange).toHaveBeenCalledWith('favorite');
  });

  it('com o filtro ativo, lista só as favoritas', () => {
    render('favorite', vi.fn(), 'dark');

    expect(screen.getByText('Ana Marcada')).toBeInTheDocument();
    expect(screen.queryByText('Comum')).not.toBeInTheDocument();
    expect(screen.queryByText('Sem flag')).not.toBeInTheDocument();
  });

  it('o filtro Todos continua mostrando todas', () => {
    render('all');

    expect(screen.getByText('Ana Marcada')).toBeInTheDocument();
    expect(screen.getByText('Comum')).toBeInTheDocument();
    expect(screen.getByText('Sem flag')).toBeInTheDocument();
  });
});
