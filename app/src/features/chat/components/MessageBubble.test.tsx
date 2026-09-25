import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithTheme } from '@/test/renderWithTheme';
import { buildTheme } from '@/theme/theme';
import { MessageBubble } from './MessageBubble';
import type { ChatMessage } from '../types';
import { chatStrings } from '../strings';

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

  it.each(['sending', 'failed'] as const)('mensagem com status %s não oferece responder', (status) => {
    renderWithTheme(<MessageBubble message={mensagem({ status, id: 'tmp-1' })} onReply={vi.fn()} />);

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

// ── Envio de mídia: progresso, falha e reação ────────────────────────────────

const up = chatStrings.upload;
const REAGIR = chatStrings.reactions.reactToMessage;

/** Bolha otimista de mídia (`tmp-<uuid>`), como o hook de envio a monta. */
const emEnvio = (over: Partial<ChatMessage> = {}): ChatMessage =>
  mensagem({
    id: 'tmp-1',
    type: 'image',
    direction: 'out',
    body: null,
    mediaUrl: 'blob:http://localhost/1',
    status: 'sending',
    externalMessageId: null,
    upload: { phase: 'uploading', progress: 42, error: null },
    ...over,
  });

describe('MessageBubble — progresso do upload', () => {
  it('mostra o percentual e cancelar entrega a mensagem', async () => {
    const onCancelUpload = vi.fn();
    renderWithTheme(<MessageBubble message={emEnvio()} onCancelUpload={onCancelUpload} />);

    expect(screen.getByRole('progressbar', { name: up.sending })).toHaveAttribute('aria-valuenow', '42');
    expect(screen.getByText(up.progress(42))).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: up.cancel }));
    expect(onCancelUpload).toHaveBeenCalledWith(expect.objectContaining({ id: 'tmp-1' }));
  });

  it('confirmando: indeterminado e sem cancelar', () => {
    renderWithTheme(
      <MessageBubble
        message={emEnvio({ upload: { phase: 'confirming', progress: 100, error: null } })}
        onCancelUpload={vi.fn()}
      />,
    );

    expect(screen.getByRole('progressbar', { name: up.sending })).not.toHaveAttribute('aria-valuenow');
    expect(screen.queryByRole('button', { name: up.cancel })).not.toBeInTheDocument();
  });

  it('mídia PENDING do servidor (enviando sem upload): indeterminado e sem cancelar', () => {
    renderWithTheme(
      <MessageBubble
        message={emEnvio({ id: 'msg-9', upload: undefined, mediaUrl: '/media/a.jpg', externalMessageId: 'EXT-9' })}
        onCancelUpload={vi.fn()}
      />,
    );

    expect(screen.getByRole('progressbar', { name: up.sending })).not.toHaveAttribute('aria-valuenow');
    expect(screen.queryByRole('button', { name: up.cancel })).not.toBeInTheDocument();
  });

  it('texto ainda enviando não ganha progresso', () => {
    renderWithTheme(<MessageBubble message={mensagem({ direction: 'out', status: 'sending' })} />);

    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });
});

describe('MessageBubble — falha no envio', () => {
  it('falha de rede: tentar de novo e descartar entregam a mensagem, sem progresso', async () => {
    const onRetry = vi.fn();
    const onDiscard = vi.fn();
    renderWithTheme(
      <MessageBubble
        message={emEnvio({ upload: { phase: 'uploading', progress: 70, error: 'network' } })}
        onRetry={onRetry}
        onDiscard={onDiscard}
        onCancelUpload={vi.fn()}
      />,
    );

    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: up.cancel })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: up.retry }));
    expect(onRetry).toHaveBeenCalledWith(expect.objectContaining({ id: 'tmp-1' }));
    await userEvent.click(screen.getByRole('button', { name: up.discard }));
    expect(onDiscard).toHaveBeenCalledWith(expect.objectContaining({ id: 'tmp-1' }));
  });

  it('sessão desconectada: oferece tentar de novo e descartar', () => {
    renderWithTheme(
      <MessageBubble
        message={emEnvio({ upload: { phase: 'confirming', progress: 100, error: 'session' } })}
        onRetry={vi.fn()}
        onDiscard={vi.fn()}
      />,
    );

    expect(screen.getByText(up.errors.sessionDisconnected)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: up.retry })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: up.discard })).toBeInTheDocument();
  });

  it('arquivo recusado: só descartar, com o motivo', () => {
    renderWithTheme(
      <MessageBubble
        message={emEnvio({ upload: { phase: 'uploading', progress: 0, error: 'rejected' } })}
        onRetry={vi.fn()}
        onDiscard={vi.fn()}
      />,
    );

    expect(screen.getByText(up.errors.rejected)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: up.retry })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: up.discard })).toBeInTheDocument();
  });

  it('mídia com falha do servidor: só tentar de novo', async () => {
    const onRetry = vi.fn();
    renderWithTheme(
      <MessageBubble
        message={emEnvio({ id: 'msg-7', upload: undefined, status: 'failed', mediaUrl: '/media/a.jpg' })}
        onRetry={onRetry}
        onDiscard={vi.fn()}
      />,
    );

    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: up.discard })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: up.retry }));
    expect(onRetry).toHaveBeenCalledWith(expect.objectContaining({ id: 'msg-7' }));
  });

  it('texto com falha não oferece tentar de novo (reenvio é só de mídia)', () => {
    renderWithTheme(
      <MessageBubble message={mensagem({ direction: 'out', status: 'failed' })} onRetry={vi.fn()} onDiscard={vi.fn()} />,
    );

    expect(screen.queryByRole('group', { name: up.failed })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: up.retry })).not.toBeInTheDocument();
  });
});

describe('MessageBubble — reação em mensagem enviando ou com falha', () => {
  const reacoes = [{ emoji: '👍', count: 1, reactedByMe: false, reactors: [] }];

  it.each(['sending', 'failed'] as const)('status %s: não oferece reagir e os chips ficam só leitura', async (status) => {
    renderWithTheme(
      <MessageBubble
        message={mensagem({ direction: 'out', status, reactions: reacoes })}
        onSetReaction={vi.fn()}
      />,
    );

    await userEvent.hover(screen.getByText('olá'));
    expect(screen.queryByRole('button', { name: REAGIR })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: chatStrings.reactions.chipLabel('👍', 1) })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Opções da mensagem' }));
    expect(screen.queryByRole('menuitem', { name: chatStrings.reactions.react })).not.toBeInTheDocument();
  });

  it('mensagem entregue continua oferecendo reagir', () => {
    renderWithTheme(<MessageBubble message={mensagem({ direction: 'out' })} onSetReaction={vi.fn()} />);

    expect(screen.getByRole('button', { name: REAGIR })).toBeInTheDocument();
  });
});

describe('MessageBubble — sem upload e sem falha, nada muda', () => {
  const semEnvio = () => {
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(screen.queryByRole('group', { name: up.failed })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: up.cancel })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: up.retry })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: up.discard })).not.toBeInTheDocument();
  };
  const callbacks = { onCancelUpload: vi.fn(), onRetry: vi.fn(), onDiscard: vi.fn() };

  it('texto comum', () => {
    renderWithTheme(
      <MessageBubble message={mensagem({ direction: 'out' })} onReply={vi.fn()} onSetReaction={vi.fn()} {...callbacks} />,
    );

    semEnvio();
    expect(screen.getByText('olá')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: RESPONDER })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: REAGIR })).toBeInTheDocument();
  });

  it('imagem comum', () => {
    renderWithTheme(
      <MessageBubble
        message={mensagem({ type: 'image', body: 'legenda', mediaUrl: '/media/foto.jpg' })}
        onReply={vi.fn()}
        onSetReaction={vi.fn()}
        {...callbacks}
      />,
    );

    semEnvio();
    expect(screen.getByRole('img', { name: 'Imagem' })).toHaveAttribute('src', '/media/foto.jpg');
    expect(screen.getByText('legenda')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: REAGIR })).toBeInTheDocument();
  });
});

describe('MessageBubble — envio de mídia no tema escuro', () => {
  it('mostra progresso e cancelar', () => {
    renderWithTheme(<MessageBubble message={emEnvio()} onCancelUpload={vi.fn()} />, 'dark');

    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '42');
    expect(screen.getByRole('button', { name: up.cancel })).toBeInTheDocument();
  });

  it('mostra a falha na superfície do tema escuro', () => {
    renderWithTheme(
      <MessageBubble
        message={emEnvio({ upload: { phase: 'uploading', progress: 70, error: 'network' } })}
        onRetry={vi.fn()}
        onDiscard={vi.fn()}
      />,
      'dark',
    );

    expect(screen.getByRole('group', { name: up.failed })).toHaveStyle({
      backgroundColor: buildTheme('dark').palette.background.paper,
    });
    expect(screen.getByRole('button', { name: up.retry })).toBeInTheDocument();
  });
});
