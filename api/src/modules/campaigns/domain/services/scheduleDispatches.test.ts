import { describe, it, expect } from 'vitest';
import { DEFAULT_DISPATCH_INTERVAL, scheduleDispatches } from './scheduleDispatches';

const now = new Date('2026-10-26T12:00:00.000Z');

describe('scheduleDispatches', () => {
  it('primeiro é imediato e os seguintes somam o intervalo sorteado', () => {
    const rolls = [0, 1, 0.5];
    const slots = scheduleDispatches(4, now, DEFAULT_DISPATCH_INTERVAL, () => rolls.shift()!);
    expect(slots.map((d) => d.getTime() - now.getTime())).toEqual([0, 8000, 23000, 34500]);
  });

  it('arredonda para milissegundo inteiro', () => {
    const [, second] = scheduleDispatches(2, now, { minMs: 0, maxMs: 10 }, () => 0.333);
    expect(second.getTime() - now.getTime()).toBe(3);
  });

  it('zero destinos devolve lista vazia', () => {
    expect(scheduleDispatches(0, now)).toEqual([]);
  });

  it('com Math.random fica dentro da faixa', () => {
    const slots = scheduleDispatches(20, now);
    for (let i = 1; i < slots.length; i++) {
      const gap = slots[i].getTime() - slots[i - 1].getTime();
      expect(gap).toBeGreaterThanOrEqual(8000);
      expect(gap).toBeLessThanOrEqual(15000);
    }
  });
});
