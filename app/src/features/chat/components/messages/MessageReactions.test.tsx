import { describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithTheme } from '@/test/renderWithTheme';
import { MessageReactions } from './MessageReactions';
import type { MessageReaction } from '../../types';
import { chatStrings } from '../../strings';

const t = chatStrings.reactions;

const thumbs: MessageReaction = {
  emoji: '👍',
  count: 1,
  reactedByMe: false,
  reactors: [{ name: 'Ana', phone: '5511999990000', isMe: false }],
};
const heart: MessageReaction = {
  emoji: '❤️',
  count: 3,
  reactedByMe: true,
  reactors: [
    { name: 'Bruno', phone: '5511999990001', isMe: false },
    { name: null, phone: null, isMe: false },
  ],
};

describe('MessageReactions', () => {
  it('oculta a contagem quando só uma pessoa reagiu e mostra quando há mais', () => {
    renderWithTheme(<MessageReactions reactions={[thumbs, heart]} onToggle={vi.fn()} />);

    const one = screen.getByRole('button', { name: t.chipLabel('👍', 1) });
    const three = screen.getByRole('button', { name: t.chipLabel('❤️', 3) });
    expect(within(one).queryByText('1')).not.toBeInTheDocument();
    expect(within(three).getByText('3')).toBeInTheDocument();
  });

  it('marca como pressionado o chip em que o operador reagiu', () => {
    renderWithTheme(<MessageReactions reactions={[thumbs, heart]} onToggle={vi.fn()} />);

    expect(screen.getByRole('button', { name: t.chipLabel('❤️', 3) })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: t.chipLabel('👍', 1) })).toHaveAttribute('aria-pressed', 'false');
  });

  it('clicar no chip alterna a reação com o emoji certo', async () => {
    const onToggle = vi.fn();
    renderWithTheme(<MessageReactions reactions={[thumbs, heart]} onToggle={onToggle} />);

    await userEvent.click(screen.getByRole('button', { name: t.chipLabel('❤️', 3) }));
    expect(onToggle).toHaveBeenCalledWith('❤️', true);

    await userEvent.click(screen.getByRole('button', { name: t.chipLabel('👍', 1) }));
    expect(onToggle).toHaveBeenLastCalledWith('👍', false);
  });

  it('agrupa entradas repetidas do mesmo emoji em um chip só', () => {
    renderWithTheme(
      <MessageReactions reactions={[thumbs, { ...thumbs, reactors: [] }]} onToggle={vi.fn()} />,
    );
    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(screen.getByRole('button', { name: t.chipLabel('👍', 2) })).toBeInTheDocument();
  });

  it('mostra no tooltip os autores, com "Participante" para quem não tem nome', async () => {
    renderWithTheme(<MessageReactions reactions={[heart]} onToggle={vi.fn()} />);

    await userEvent.tab();
    expect(await screen.findByRole('tooltip')).toHaveTextContent(
      t.reactorsTooltip(['Bruno', t.participant]),
    );
  });

  it('mostra "Você" para a reação da própria conta', async () => {
    renderWithTheme(
      <MessageReactions
        reactions={[{ ...heart, reactors: [{ name: null, phone: null, isMe: true }] }]}
        onToggle={vi.fn()}
      />,
    );

    await userEvent.tab();
    expect(await screen.findByRole('tooltip')).toHaveTextContent(t.reactorsTooltip([t.you]));
  });

  it('sem onToggle, os chips aparecem mas não são botões', () => {
    renderWithTheme(<MessageReactions reactions={[thumbs]} />);

    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByRole('img', { name: t.chipLabel('👍', 1) })).toBeInTheDocument();
  });

  it('não renderiza nada sem reações', () => {
    renderWithTheme(<MessageReactions reactions={[]} onToggle={vi.fn()} />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('renderiza no tema escuro', () => {
    renderWithTheme(<MessageReactions reactions={[thumbs, heart]} onToggle={vi.fn()} />, 'dark');

    expect(screen.getByRole('button', { name: t.chipLabel('❤️', 3) })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('3')).toBeInTheDocument();
  });
});
