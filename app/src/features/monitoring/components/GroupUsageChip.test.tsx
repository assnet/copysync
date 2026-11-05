import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithTheme } from '@/test/renderWithTheme';
import { ChannelUsageChips } from './GroupUsageChip';

const items = [{ channel: 'whatsapp' as const, used: 3, max: 5 }];

describe('ChannelUsageChips', () => {
  it('com sharedLimit, dica mantém o uso, avisa a soma e linka /broadcast-groups', async () => {
    renderWithTheme(<ChannelUsageChips items={items} sharedLimit />);
    await userEvent.hover(screen.getByRole('img'));
    expect(await screen.findByText(/WhatsApp: 3 de 5 do seu plano/)).toBeInTheDocument();
    expect(screen.getByText(/o limite soma o gerador e o monitoramento/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ver grupos de disparo' })).toHaveAttribute('href', '/broadcast-groups');
  });

  it('sem sharedLimit (grupos monitorados), só o uso', async () => {
    renderWithTheme(<ChannelUsageChips items={items} />);
    await userEvent.hover(screen.getByRole('img'));
    expect(await screen.findByText(/WhatsApp: 3 de 5 do seu plano/)).toBeInTheDocument();
    expect(screen.queryByRole('link')).toBeNull();
  });
});
