import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { renderWithTheme } from '@/test/renderWithTheme';
import { ChannelCounterChips } from './ChannelCounterChips';

const base = {
  channels: ['whatsapp'] as const,
  count: { whatsapp: 2, telegram: 0 },
  limits: { whatsapp: 5, telegram: 0 },
  label: () => 'WhatsApp 2/5',
  ariaLabel: () => '2 de 5 grupos selecionados',
};

describe('ChannelCounterChips', () => {
  it('com sharedLimitHint, dica diz que o limite soma e leva para /broadcast-groups', async () => {
    renderWithTheme(<MemoryRouter><ChannelCounterChips {...base} sharedLimitHint /></MemoryRouter>);
    await userEvent.hover(screen.getByLabelText('2 de 5 grupos selecionados'));
    expect(await screen.findByText(/o limite soma o gerador e o monitoramento/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ver grupos de disparo' })).toHaveAttribute('href', '/broadcast-groups');
  });

  it('sem sharedLimitHint (sessões), sem dica nem foco extra', async () => {
    renderWithTheme(<ChannelCounterChips {...base} />);
    const chip = screen.getByLabelText('2 de 5 grupos selecionados');
    await userEvent.hover(chip);
    expect(chip).not.toHaveAttribute('tabindex');
    expect(screen.queryByRole('tooltip')).toBeNull();
  });
});
