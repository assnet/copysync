import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';
import { renderWithTheme } from '@/test/renderWithTheme';
import type { SubscriptionLimitItem } from '@/types/api.types';
import { subscriptionStrings as t, type SubscriptionChannel } from '../strings';
import { SubscriptionLimitsTable } from './SubscriptionLimitsTable';

const L = (key: string, channel: SubscriptionLimitItem['channel'], kind: SubscriptionLimitItem['kind'], used: number | null, limit: number | null, enabled = limit !== 0): SubscriptionLimitItem =>
  ({ key, channel, kind, used, limit, enabled });

const limits: SubscriptionLimitItem[] = [
  L('whatsapp_sessions', 'whatsapp', 'count', 1, 1),
  L('monitored_groups', 'whatsapp', 'count', 8, 10),
  L('broadcast_groups', 'whatsapp', 'count', 3, null),
  L('link_rotations', 'whatsapp', 'count', 1, 10),
  L('telegram_sessions', 'telegram', 'count', 0, 0),
  L('offer_generations_per_day', null, 'daily', 4, 50),
  L('storefront_enabled', null, 'feature', null, null, true),
  L('offer_story_enabled', null, 'feature', null, null, false),
  L('chave_desconhecida', null, 'count', 1, 2),
];

const setup = (channel: SubscriptionChannel = 'whatsapp', mode: 'light' | 'dark' = 'light', onChannelChange = vi.fn()) => {
  renderWithTheme(<SubscriptionLimitsTable limits={limits} channel={channel} onChannelChange={onChannelChange} />, mode);
  return onChannelChange;
};

const row = (key: string) => document.querySelector(`tr[data-key="${key}"]`) as HTMLElement;
const bar = (key: string) => within(row(key)).queryByRole('progressbar');

describe('SubscriptionLimitsTable', () => {
  it.each(['light', 'dark'] as const)('renderiza tabelas semânticas no modo %s', (mode) => {
    setup('whatsapp', mode);
    expect(screen.getAllByRole('table')).toHaveLength(2);
    expect(screen.getByRole('tab', { name: t.channel.whatsapp })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('rowheader', { name: new RegExp(t.limit.monitored_groups.label) })).toBeInTheDocument();
  });

  it('100% é error, ≥ 80% warning, abaixo é primary', () => {
    setup();
    expect(bar('whatsapp_sessions')).toHaveClass('MuiLinearProgress-colorError');
    expect(bar('whatsapp_sessions')).toHaveAttribute('aria-valuenow', '100');
    expect(bar('monitored_groups')).toHaveClass('MuiLinearProgress-colorWarning');
    expect(bar('link_rotations')).toHaveClass('MuiLinearProgress-colorPrimary');
    expect(bar('monitored_groups')).toHaveAccessibleName(t.limits.usageAria(t.limit.monitored_groups.label, 8, 10));
  });

  it('ilimitado sem barra, com uso e "Ilimitado"', () => {
    setup();
    expect(bar('broadcast_groups')).toBeNull();
    expect(within(row('broadcast_groups')).getByText(t.limits.usageUnlimited(3))).toBeInTheDocument();
    expect(within(row('broadcast_groups')).getByText(t.limits.unlimited)).toBeInTheDocument();
  });

  it('Telegram com limite 0 mostra "A partir do PRO" e sem barra', () => {
    setup('telegram');
    expect(within(row('telegram_sessions')).getByText(t.limits.availableFrom('PRO'))).toBeInTheDocument();
    expect(bar('telegram_sessions')).toBeNull();
    expect(row('whatsapp_sessions')).toBeNull();
  });

  it('linha diária mostra "hoje"; feature como Incluso / A partir do X; chave desconhecida some', () => {
    setup();
    expect(within(row('offer_generations_per_day')).getByText(t.limits.usageToday(4, 50))).toBeInTheDocument();
    expect(within(row('offer_generations_per_day')).getByText(`50 ${t.limits.today}`)).toBeInTheDocument();
    expect(within(row('storefront_enabled')).getByText(t.limits.included)).toBeInTheDocument();
    expect(within(row('offer_story_enabled')).getByText(t.limits.availableFrom('MAX'))).toBeInTheDocument();
    expect(row('chave_desconhecida')).toBeNull();
  });

  it('Tooltip com o hint do limite', async () => {
    setup();
    const label = within(row('monitored_groups')).getByText(t.limit.monitored_groups.label);
    fireEvent.mouseOver(label);
    expect(await screen.findByRole('tooltip')).toHaveTextContent(t.limit.monitored_groups.hint);
  });

  it('troca de aba avisa o canal', () => {
    const onChange = setup();
    fireEvent.click(screen.getByRole('tab', { name: t.channel.telegram }));
    expect(onChange).toHaveBeenCalledWith('telegram');
  });
});
