import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithTheme } from '@/test/renderWithTheme';
import { ConversationListItem } from './ConversationListItem';
import type { ChatConversation } from '../types';

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

function render(conversation: ChatConversation, mode?: 'light' | 'dark') {
  return renderWithTheme(
    <ConversationListItem conversation={conversation} selected={false} onClick={vi.fn()} />,
    mode,
  );
}

describe('ConversationListItem', () => {
  it('mostra a quantidade de mensagens não lidas', () => {
    render(makeConversation({ unreadCount: 4 }));
    expect(screen.getByText('4')).toBeInTheDocument();
  });

  it('destaca conversa marcada como não lida sem inventar contagem', () => {
    // Marcar como não lida — no painel ou em outro aparelho — não cria mensagem
    // pendente: o destaque aparece, o número não.
    const { container } = render(makeConversation({ unreadCount: 0, manuallyUnread: true }));
    expect(container.querySelector('.MuiBadge-badge')).toBeInTheDocument();
    expect(screen.queryByText('1')).not.toBeInTheDocument();
  });

  it('não destaca conversa lida', () => {
    const { container } = render(makeConversation({ unreadCount: 0, manuallyUnread: false }));
    expect(container.querySelector('.MuiBadge-badge')).not.toBeInTheDocument();
  });

  it('exibe indicador de conversa fixada', () => {
    render(makeConversation({ pinned: true }));
    expect(screen.getByTitle('Fixada')).toBeInTheDocument();
  });

  it('exibe indicador de conversa silenciada enquanto o silêncio vale', () => {
    const futuro = new Date(Date.now() + 3_600_000).toISOString();
    render(makeConversation({ mutedUntil: futuro }));
    expect(screen.getByTitle('Silenciada')).toBeInTheDocument();
  });

  it('não exibe silenciamento já expirado', () => {
    const passado = new Date(Date.now() - 1_000).toISOString();
    render(makeConversation({ mutedUntil: passado }));
    expect(screen.queryByTitle('Silenciada')).not.toBeInTheDocument();
  });

  it('mantém o destaque de não lida no tema escuro', () => {
    const { container } = render(makeConversation({ unreadCount: 0, manuallyUnread: true }), 'dark');
    expect(container.querySelector('.MuiBadge-badge')).toBeInTheDocument();
    expect(screen.getByText('Geovana Silvestre')).toBeInTheDocument();
  });
});
