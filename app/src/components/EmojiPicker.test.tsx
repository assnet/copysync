import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { PaletteMode } from '@mui/material';
import { renderWithTheme } from '@/test/renderWithTheme';

type FakeProps = {
  emojiStyle: string;
  theme: string;
  searchPlaceholder: string;
  onEmojiClick: (data: { emoji: string }) => void;
};

/** Substitui a lib por um dublê que expõe as props recebidas via texto/role. */
function mockLib() {
  vi.doMock('emoji-picker-react/dist/data/emojis-pt', () => ({ default: { categories: {}, emojis: {} } }));
  vi.doMock('emoji-picker-react', () => ({
    default: ({ emojiStyle, theme, searchPlaceholder, onEmojiClick }: FakeProps) => (
      <div>
        <input placeholder={searchPlaceholder} />
        <span>{`estilo:${emojiStyle} tema:${theme}`}</span>
        <button type="button" onClick={() => onEmojiClick({ emoji: '👍' })}>
          escolher
        </button>
      </div>
    ),
    EmojiStyle: { NATIVE: 'native' },
    Theme: { DARK: 'dark', LIGHT: 'light' },
    Categories: {},
  }));
}

async function renderPicker(mode: PaletteMode = 'light') {
  const { EmojiPicker } = await import('./EmojiPicker');
  const onSelect = vi.fn();
  const onClose = vi.fn();
  renderWithTheme(<EmojiPicker onSelect={onSelect} onClose={onClose} />, mode);
  return { onSelect, onClose };
}

describe('EmojiPicker', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doUnmock('emoji-picker-react');
    vi.doUnmock('emoji-picker-react/dist/data/emojis-pt');
  });

  it('entrega só o caractere do emoji escolhido, com emoji nativo e busca em português', async () => {
    mockLib();
    const { onSelect } = await renderPicker();

    await userEvent.click(await screen.findByRole('button', { name: 'escolher' }));

    expect(onSelect).toHaveBeenCalledWith('👍');
    expect(screen.getByPlaceholderText('Buscar emoji')).toBeInTheDocument();
    expect(screen.getByText('estilo:native tema:light')).toBeInTheDocument();
  });

  it('segue o modo escuro do painel', async () => {
    mockLib();
    await renderPicker('dark');

    expect(await screen.findByText('estilo:native tema:dark')).toBeInTheDocument();
  });

  it('fecha em silêncio quando o carregamento do seletor falha', async () => {
    vi.doMock('emoji-picker-react', () => {
      throw new Error('chunk indisponível');
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const { onClose } = await renderPicker();

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
