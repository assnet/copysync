import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { renderWithTheme } from '@/test/renderWithTheme';
import { PostingWindowField, type PostingWindowValue } from './PostingWindowField';
import { postingWindowStrings as t } from './postingWindowStrings';

const day: PostingWindowValue = { window: { lo: 480, hi: 1200, overnight: false }, weekdaysMask: 127 };

describe.each(['light', 'dark'] as const)('PostingWindowField (%s)', (mode) => {
  const setup = (value: PostingWindowValue = day, onChange = vi.fn()) => {
    renderWithTheme(<PostingWindowField value={value} onChange={onChange} />, mode);
    return onChange;
  };

  it('resume faixa, duração e dias', () => {
    setup();
    expect(screen.getByRole('status')).toHaveTextContent('08:00 → 20:00 · 12 h · Todos os dias');
    expect(screen.getByRole('slider', { name: `${t.sliderAria}: ${t.start}` })).toHaveAttribute('aria-valuenow', '480');
  });

  it('dia inteiro e resumos de dias', () => {
    setup({ window: { lo: 0, hi: 1440, overnight: false }, weekdaysMask: 62 });
    expect(screen.getByRole('status')).toHaveTextContent(`${t.fullDay} · ${t.daysWeek}`);
  });

  it('lista dias avulsos', () => {
    setup({ ...day, weekdaysMask: 0b0101010 });
    expect(screen.getByRole('status')).toHaveTextContent('Seg, Qua, Sex');
  });

  it('chips refletem o mask e desmarcar atualiza o mask', () => {
    const onChange = setup();
    const sunday = screen.getByRole('button', { name: 'Domingo' });
    expect(sunday).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(sunday);
    expect(onChange).toHaveBeenCalledWith({ ...day, weekdaysMask: 126 });
  });

  it('marca dia desligado', () => {
    const onChange = setup({ ...day, weekdaysMask: 62 });
    const saturday = screen.getByRole('button', { name: 'Sábado' });
    expect(saturday).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(saturday);
    expect(onChange).toHaveBeenCalledWith({ ...day, weekdaysMask: 126 });
  });

  it('último dia não sai', () => {
    const onChange = setup({ ...day, weekdaysMask: 2 });
    fireEvent.click(screen.getByRole('button', { name: 'Segunda-feira' }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('noturna a partir do dia inteiro vira 22:00 → 06:00', () => {
    const onChange = setup({ window: { lo: 0, hi: 1440, overnight: false }, weekdaysMask: 127 });
    fireEvent.click(screen.getByRole('checkbox', { name: new RegExp(t.overnight.replace(/[()]/g, '\\$&')) }));
    expect(onChange).toHaveBeenCalledWith({ window: { lo: 360, hi: 1320, overnight: true }, weekdaysMask: 127 });
  });

  it('janela vazia mostra o erro', () => {
    setup({ window: { lo: 0, hi: 1440, overnight: true }, weekdaysMask: 127 });
    expect(screen.getByText(t.empty)).toBeInTheDocument();
  });

  it('tooltip explica que fora do horário a oferta espera', () => {
    setup();
    expect(screen.getByRole('button', { name: t.helpAria })).toBeInTheDocument();
    expect(screen.getByText(t.helpShort)).toBeInTheDocument();
  });
});
