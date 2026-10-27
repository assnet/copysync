import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { RangeSlider, clampRange } from './RangeSlider';

describe('clampRange', () => {
  const b = { min: 5, max: 120 };

  it('prende aos limites e ao passo', () => {
    expect(clampRange([0, 500], b)).toEqual([5, 120]);
    expect(clampRange([7.4, 10.6], { ...b, step: 1 })).toEqual([7, 11]);
  });

  it('distância mínima: o cursor arrastado manda e o outro cede', () => {
    expect(clampRange([10, 11], { ...b, minDistance: 5 }, 0)).toEqual([10, 15]);
    expect(clampRange([10, 11], { ...b, minDistance: 5 }, 1)).toEqual([6, 11]);
  });

  it('distância mínima encostada no limite da escala', () => {
    expect(clampRange([119, 120], { ...b, minDistance: 5 }, 0)).toEqual([115, 120]);
    expect(clampRange([5, 6], { ...b, minDistance: 5 }, 1)).toEqual([5, 10]);
  });
});

describe('RangeSlider', () => {
  const setup = (onChange = vi.fn()) => {
    render(
      <RangeSlider value={[8, 15]} min={5} max={120} minDistance={1} ariaLabel="Intervalo" formatValue={(v) => `${v} s`} onChange={onChange} />,
    );
    return onChange;
  };

  it('expõe dois cursores acessíveis com os valores e mostra os extremos', () => {
    setup();
    const lo = screen.getByRole('slider', { name: 'Intervalo: Mínimo' });
    const hi = screen.getByRole('slider', { name: 'Intervalo: Máximo' });
    expect(lo).toHaveAttribute('aria-valuenow', '8');
    expect(hi).toHaveAttribute('aria-valuenow', '15');
    expect(lo).toHaveAttribute('aria-valuetext', '8 s');
    // Rótulo flutuante do cursor repete o valor: conta ocorrências, não unicidade
    for (const text of ['8 s', '15 s', '5 s', '120 s']) expect(screen.getAllByText(text).length).toBeGreaterThan(0);
  });

  it('teclado move o cursor e devolve o par', () => {
    const onChange = setup();
    fireEvent.keyDown(screen.getByRole('slider', { name: 'Intervalo: Mínimo' }), { key: 'ArrowRight' });
    expect(onChange).toHaveBeenLastCalledWith([9, 15]);
    fireEvent.keyDown(screen.getByRole('slider', { name: 'Intervalo: Máximo' }), { key: 'ArrowLeft' });
    expect(onChange).toHaveBeenLastCalledWith([8, 14]);
  });

  it('não deixa o mínimo cruzar o máximo', () => {
    const onChange = vi.fn();
    render(<RangeSlider value={[14, 15]} min={5} max={120} minDistance={1} ariaLabel="Intervalo" onChange={onChange} />);
    fireEvent.keyDown(screen.getByRole('slider', { name: 'Intervalo: Mínimo' }), { key: 'ArrowRight' });
    expect(onChange).toHaveBeenLastCalledWith([15, 16]);
  });
});

describe('RangeSlider com status (termômetro)', () => {
  it('mostra o rótulo centralizado como status acessível', () => {
    render(
      <RangeSlider value={[120, 300]} min={60} max={3600} step={60} ariaLabel="Intervalo" onChange={() => undefined}
        status={{ score: 0.3, label: 'Risco elevado', ariaLabel: 'Nível de risco do intervalo' }} />,
    );
    expect(screen.getByRole('status', { name: 'Nível de risco do intervalo' })).toHaveTextContent('Risco elevado');
  });
});
