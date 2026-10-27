import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CooldownBar, cooldownFraction, cooldownRemainingSeconds, energyColor } from './CooldownBar';

describe('cooldownFraction', () => {
  it('cheia no início, metade no meio, vazia no fim e depois', () => {
    expect(cooldownFraction(0, 10_000, 0)).toBe(1);
    expect(cooldownFraction(0, 10_000, 5_000)).toBe(0.5);
    expect(cooldownFraction(0, 10_000, 10_000)).toBe(0);
    expect(cooldownFraction(0, 10_000, 99_000)).toBe(0);
  });

  it('antes do início fica cheia; janela vazia ou invertida = 0', () => {
    expect(cooldownFraction(5_000, 10_000, 0)).toBe(1);
    expect(cooldownFraction(5_000, 5_000, 0)).toBe(0);
    expect(cooldownFraction(9_000, 5_000, 0)).toBe(0);
  });
});

describe('cooldownRemainingSeconds', () => {
  it('arredonda para cima e não fica negativo', () => {
    expect(cooldownRemainingSeconds(10_000, 0)).toBe(10);
    expect(cooldownRemainingSeconds(10_000, 9_001)).toBe(1);
    expect(cooldownRemainingSeconds(10_000, 10_000)).toBe(0);
    expect(cooldownRemainingSeconds(10_000, 12_000)).toBe(0);
  });
});

describe('energyColor', () => {
  const palette = { full: 'green', mid: 'orange', low: 'red' };
  it('mistura contínua cheia → meio → vazia', () => {
    expect(energyColor(1, palette)).toBe('color-mix(in oklab, green 100%, orange)');
    expect(energyColor(0.5, palette)).toBe('color-mix(in oklab, green 0%, orange)');
    expect(energyColor(0.25, palette)).toBe('color-mix(in oklab, orange 50%, red)');
    expect(energyColor(0, palette)).toBe('color-mix(in oklab, orange 0%, red)');
  });
});

describe('CooldownBar', () => {
  it('mostra o tempo restante e expõe progressbar acessível', () => {
    render(<CooldownBar startAt={0} endAt={12_000} now={() => 3_500} ariaLabel="Próximo envio" label="Grupo A" />);
    const bar = screen.getByRole('progressbar', { name: 'Próximo envio' });
    expect(bar).toHaveAttribute('aria-valuemax', '12');
    expect(bar).toHaveAttribute('aria-valuenow', '9');
    expect(bar).toHaveAttribute('aria-valuetext', '9 s');
    expect(screen.getByText('Grupo A')).toBeInTheDocument();
  });

  it('zerada: mostra o texto de concluído e chama onComplete uma vez', () => {
    const onComplete = vi.fn();
    render(<CooldownBar startAt={0} endAt={1_000} now={() => 5_000} ariaLabel="x" doneLabel="Enviando…" onComplete={onComplete} />);
    expect(screen.getByText('Enviando…')).toBeInTheDocument();
    expect(onComplete).toHaveBeenCalledTimes(1);
  });
});
