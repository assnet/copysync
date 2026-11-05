import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { renderWithTheme } from '@/test/renderWithTheme';
import type { PostingWindowValue } from '@/components';
import type { OfferConfigSettings } from '@/types/api.types';
import { ConfigScheduleStep } from './ConfigScheduleStep';
import { offerStrings } from '../../strings';
import { postingWindowFromConfig, postingWindowToRequest, postingWindowValid } from '../../utils/offerConfig';

const value: PostingWindowValue = { window: { lo: 480, hi: 1320, overnight: false }, weekdaysMask: 127 };
const base: OfferConfigSettings = {
  sessionIds: ['s1'], intervalMinSeconds: 120, intervalMaxSeconds: 300, dispatchOrder: 'SEQUENTIAL',
  windowStartMinute: 0, windowEndMinute: 1440, weekdays: [0, 1, 2, 3, 4, 5, 6],
};

describe.each(['light', 'dark'] as const)('ConfigScheduleStep (%s)', (mode) => {
  it('mostra a janela, os dias e o aviso do agendado', () => {
    renderWithTheme(<ConfigScheduleStep value={value} onChange={vi.fn()} />, mode);
    expect(screen.getByRole('status')).toHaveTextContent('08:00 → 22:00');
    expect(screen.getByText(offerStrings.wizard.schedule.scheduledNote)).toBeInTheDocument();
  });

  it('desmarcar um dia propaga o mask', () => {
    const onChange = vi.fn();
    renderWithTheme(<ConfigScheduleStep value={value} onChange={onChange} />, mode);
    fireEvent.click(screen.getByRole('button', { name: 'Domingo' }));
    expect(onChange).toHaveBeenCalledWith({ ...value, weekdaysMask: 126 });
  });
});

describe('horário do gerador (config ↔ pedido)', () => {
  it('sem configuração: dia inteiro, todos os dias', () => {
    expect(postingWindowFromConfig(null)).toEqual({ window: { lo: 0, hi: 1440, overnight: false }, weekdaysMask: 127 });
  });

  it('noturna e dias avulsos fazem ida e volta', () => {
    const cfg = { ...base, windowStartMinute: 1320, windowEndMinute: 360, weekdays: [1, 3, 5] };
    const v = postingWindowFromConfig(cfg);
    expect(v).toEqual({ window: { lo: 360, hi: 1320, overnight: true }, weekdaysMask: 0b0101010 });
    expect(postingWindowToRequest(v)).toEqual({ windowStartMinute: 1320, windowEndMinute: 360, weekdays: [1, 3, 5] });
  });

  it('lista de dias vazia volta para todos os dias', () => {
    expect(postingWindowFromConfig({ ...base, weekdays: [] }).weekdaysMask).toBe(127);
  });

  it('valida faixa e dias', () => {
    expect(postingWindowValid(value)).toBe(true);
    expect(postingWindowValid({ ...value, weekdaysMask: 0 })).toBe(false);
    expect(postingWindowValid({ window: { lo: 0, hi: 1440, overnight: true }, weekdaysMask: 127 })).toBe(false);
  });
});
