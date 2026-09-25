import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { PaletteMode } from '@mui/material';
import { renderWithTheme } from '@/test/renderWithTheme';
import { chatStrings } from '@/features/chat/strings';
import { ReactionBar } from './ReactionBar';

// Dublê do picker completo: evita baixar a lib e expõe a escolha por um botão.
vi.mock('@/components/EmojiPicker', () => ({
  EmojiPicker: ({ onSelect }: { onSelect: (emoji: string) => void }) => (
    <button type="button" onClick={() => onSelect('🔥')}>
      escolher no picker
    </button>
  ),
}));

const texts = chatStrings.reactions;

function renderBar(activeEmoji: string | null = null, mode: PaletteMode = 'light') {
  const anchor = document.createElement('button');
  document.body.appendChild(anchor);
  const onSelect = vi.fn();
  const onClose = vi.fn();
  renderWithTheme(
    <ReactionBar anchorEl={anchor} open onClose={onClose} activeEmoji={activeEmoji} onSelect={onSelect} />,
    mode,
  );
  return { onSelect, onClose };
}

const emojiButton = (emoji: string) => screen.getByRole('button', { name: emoji });

describe('ReactionBar', () => {
  it('reage com o emoji clicado na barra e fecha', async () => {
    const { onSelect, onClose } = renderBar();
    await userEvent.click(emojiButton('😂'));
    expect(onSelect).toHaveBeenCalledWith('😂');
    expect(onClose).toHaveBeenCalled();
  });

  it('marca o emoji ativo e clicar nele remove a reação', async () => {
    const { onSelect } = renderBar('❤️');
    expect(emojiButton('❤️')).toHaveAttribute('aria-pressed', 'true');
    expect(emojiButton('👍')).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(emojiButton('❤️'));
    expect(onSelect).toHaveBeenCalledWith(null);
  });

  it('fecha com Esc', async () => {
    const { onClose } = renderBar();
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });

  it('move o foco pelos botões com as setas, dando a volta nas pontas', async () => {
    renderBar('😮');
    await waitFor(() => expect(emojiButton('😮')).toHaveFocus());
    await userEvent.keyboard('{ArrowRight}');
    expect(emojiButton('😢')).toHaveFocus();
    await userEvent.keyboard('{ArrowLeft}{ArrowLeft}');
    expect(emojiButton('😂')).toHaveFocus();
    await userEvent.keyboard('{Home}{ArrowLeft}');
    expect(screen.getByRole('button', { name: texts.openFullPicker })).toHaveFocus();
    expect(emojiButton('😂')).toHaveAttribute('tabindex', '-1');
  });

  it('abre o picker completo pelo + e reage com o emoji escolhido lá', async () => {
    const { onSelect, onClose } = renderBar(null, 'dark');
    expect(screen.getByRole('toolbar', { name: texts.quickBar })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: texts.openFullPicker }));
    await userEvent.click(screen.getByRole('button', { name: 'escolher no picker' }));
    expect(onSelect).toHaveBeenCalledWith('🔥');
    expect(onClose).toHaveBeenCalled();
  });
});
