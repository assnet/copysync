import { describe, expect, it } from 'vitest';
import { nextHuntRunAt, nextHuntRunNextDay } from './huntSchedule';
import { ALL_WEEKDAYS_MASK, weekdaysMask } from '../postingWindow';

// 2026-11-12 é quinta; São Paulo = UTC−3
const at = (iso: string) => new Date(iso);
const FULL = { startMinute: 0, endMinute: 1440, weekdaysMask: ALL_WEEKDAYS_MASK, intervalMinutes: 60 };

describe('nextHuntRunAt', () => {
  it('dia inteiro: now + intervalo', () => {
    expect(nextHuntRunAt(at('2026-11-12T15:00:00Z'), FULL).toISOString()).toBe('2026-11-12T16:00:00.000Z');
  });

  it('cai fora da janela → próxima abertura', () => {
    // janela 08:00–18:00 SP; 17:30 SP + 60 min = 18:30 → amanhã 08:00 SP
    const s = { ...FULL, startMinute: 480, endMinute: 1080 };
    expect(nextHuntRunAt(at('2026-11-12T20:30:00Z'), s).toISOString()).toBe('2026-11-13T11:00:00.000Z');
  });

  it('pula dia fora do mask', () => {
    // só segunda; quinta 15:00 SP → segunda 08:00 SP
    const s = { ...FULL, startMinute: 480, endMinute: 1080, weekdaysMask: weekdaysMask([1]) };
    expect(nextHuntRunAt(at('2026-11-12T18:00:00Z'), s).toISOString()).toBe('2026-11-16T11:00:00.000Z');
  });

  it.each([0, 29, 30.5, NaN])('intervalo inválido (%s) lança', (m) => {
    expect(() => nextHuntRunAt(at('2026-11-12T15:00:00Z'), { ...FULL, intervalMinutes: m })).toThrow(RangeError);
  });

  it('mask inválido lança', () => {
    expect(() => nextHuntRunAt(at('2026-11-12T15:00:00Z'), { ...FULL, weekdaysMask: 0 })).toThrow(RangeError);
  });
});

describe('nextHuntRunNextDay', () => {
  it('dia inteiro → meia-noite seguinte em SP', () => {
    expect(nextHuntRunNextDay(at('2026-11-12T15:00:00Z'), FULL).toISOString()).toBe('2026-11-13T03:00:00.000Z');
  });

  it('janela → abertura do dia seguinte, mesmo se hoje ainda está aberta', () => {
    const s = { ...FULL, startMinute: 480, endMinute: 1080 };
    expect(nextHuntRunNextDay(at('2026-11-12T10:00:00Z'), s).toISOString()).toBe('2026-11-13T11:00:00.000Z');
  });
});
