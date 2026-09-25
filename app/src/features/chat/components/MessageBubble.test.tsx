import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithTheme } from '@/test/renderWithTheme';
import { MessageBubble } from './MessageBubble';
import type { ChatMessage } from '../types';

vi.mock('@/components/EmojiPicker', () => ({ EmojiPicker: () => null }));

const mensagem = (over: Partial<ChatMessage> = {}): ChatMessage => ({
  id: 'msg-1',
  conversationId: 'conv-1',
  type: 'text',
  direction: 'in',
  body: 'olá',
  timestamp: '2026-09-25T12:00:00.000Z',
  status: 'delivered',
  externalMessageId: 'EXT-1',
  ...over,
});

const RESPONDER = 'Responder mensagem';

describe('MessageBubble — responder', () => {
  it('oferece responder e entrega a mensagem ao clicar', async () => {
    const onReply = vi.fn();
    renderWithTheme(<MessageBubble message={mensagem()} onReply={onReply} />);

    // As ações só aceitam clique com a bolha sob o mouse (ou com foco), como na tela.
    await userEvent.hover(screen.getByText('olá'));
    await userEvent.click(screen.getByRole('button', { name: RESPONDER }));

    expect(onReply).toHaveBeenCalledWith(expect.objectContaining({ id: 'msg-1' }));
  });

  it('mensagem apagada não oferece responder — não há o que citar no WhatsApp', () => {
    renderWithTheme(<MessageBubble message={mensagem({ isDeleted: true, body: null })} onReply={vi.fn()} />);

    expect(screen.queryByRole('button', { name: RESPONDER })).not.toBeInTheDocument();
  });

  it('sem onReply não renderiza o botão', () => {
    renderWithTheme(<MessageBubble message={mensagem()} />);

    expect(screen.queryByRole('button', { name: RESPONDER })).not.toBeInTheDocument();
  });

  it('oferece responder também no tema escuro', () => {
    renderWithTheme(<MessageBubble message={mensagem({ direction: 'out' })} onReply={vi.fn()} />, 'dark');

    expect(screen.getByRole('button', { name: RESPONDER })).toBeInTheDocument();
  });
});
