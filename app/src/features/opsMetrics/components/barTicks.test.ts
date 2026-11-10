import { afterEach, describe, expect, it, vi } from 'vitest';
import { barTickSet, barTickStep } from './barTicks';

const H = 3_600_000;

describe('barTickStep', () => {
  it('7 dias no celular (4 rótulos) usa passo de 2 dias, não 1 dia', () => {
    const times = Array.from({ length: 169 }, (_, i) => i * H);
    expect(barTickStep(times, 4)).toBe(2880 * 60_000);
  });
});

describe('barTickSet', () => {
  afterEach(() => vi.restoreAllMocks());

  it('marca o primeiro balde de cada passo mesmo em fuso de meia hora (+05:30)', () => {
    vi.spyOn(Date.prototype, 'getTimezoneOffset').mockReturnValue(-330);
    const times = Array.from({ length: 48 }, (_, i) => i * H); // baldes de 60 min em UTC cheio
    const ticks = barTickSet(times, 6 * H);
    expect(ticks.size).toBeGreaterThanOrEqual(7);
    expect(ticks.size).toBeLessThanOrEqual(9);
  });

  it('em fuso inteiro marca exatamente as horas múltiplas do passo', () => {
    vi.spyOn(Date.prototype, 'getTimezoneOffset').mockReturnValue(0);
    const times = Array.from({ length: 24 }, (_, i) => i * H);
    expect([...barTickSet(times, 6 * H)]).toEqual([0, 6 * H, 12 * H, 18 * H]);
  });
});
