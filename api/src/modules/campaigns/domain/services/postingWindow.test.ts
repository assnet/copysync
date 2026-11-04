import { describe, expect, it } from 'vitest';
import {
  ALL_WEEKDAYS_MASK,
  isValidWeekdaysMask,
  isWithinPostingWindow,
  resolveStartWithinPostingWindow,
  weekdayInZone,
  weekdaysFromMask,
  weekdaysMask,
} from './postingWindow';

// 2026-11-06 = sexta. São Paulo = UTC-3 (sem horário de verão).
const sp = (day: number, hh: number, mm = 0) => new Date(Date.UTC(2026, 10, day, hh + 3, mm));
const SUN = 0, MON = 1, FRI = 5, SAT = 6;

describe('postingWindow', () => {
  it('mask ↔ lista de dias', () => {
    expect(weekdaysMask([0, 1, 2, 3, 4, 5, 6])).toBe(ALL_WEEKDAYS_MASK);
    expect(weekdaysMask([SAT, SUN])).toBe(65);
    expect(weekdaysFromMask(65)).toEqual([0, 6]);
    expect(() => weekdaysMask([7])).toThrow(RangeError);
  });

  it('mask 0 é inválido', () => {
    expect(isValidWeekdaysMask(0)).toBe(false);
    expect(isValidWeekdaysMask(128)).toBe(false);
    expect(isValidWeekdaysMask(1.5)).toBe(false);
    expect(isValidWeekdaysMask(1)).toBe(true);
    const w = { startMinute: 0, endMinute: 1440, weekdaysMask: 0 };
    expect(isWithinPostingWindow(sp(6, 10), w)).toBe(false);
    expect(() => resolveStartWithinPostingWindow(sp(6, 10), w)).toThrow(RangeError);
  });

  it('dia da semana no fuso, virada 23:59/00:00', () => {
    expect(weekdayInZone(sp(6, 23, 59))).toBe(FRI);
    expect(weekdayInZone(sp(7, 0, 0))).toBe(SAT);
    // 02:00Z de sábado ainda é sexta 23:00 em SP
    expect(weekdayInZone(new Date(Date.UTC(2026, 10, 7, 2)))).toBe(FRI);
  });

  it('dia inteiro respeita a virada 23:59/00:00', () => {
    const fri = { startMinute: 0, endMinute: 1440, weekdaysMask: weekdaysMask([FRI]) };
    expect(isWithinPostingWindow(sp(6, 23, 59), fri)).toBe(true);
    expect(isWithinPostingWindow(sp(7, 0, 0), fri)).toBe(false);
    expect(isWithinPostingWindow(sp(6, 0, 0), fri)).toBe(true);
  });

  it('sexta 22–02 cobre sábado 01:00 (madrugada = dia do início)', () => {
    const w = { startMinute: 1320, endMinute: 120, weekdaysMask: weekdaysMask([FRI]) };
    expect(isWithinPostingWindow(sp(6, 22), w)).toBe(true);
    expect(isWithinPostingWindow(sp(6, 23, 59), w)).toBe(true);
    expect(isWithinPostingWindow(sp(7, 0, 0), w)).toBe(true);
    expect(isWithinPostingWindow(sp(7, 1), w)).toBe(true);
    expect(isWithinPostingWindow(sp(7, 2), w)).toBe(false);
    // sábado 22h não é dia do início; sexta 01:00 pertence à quinta
    expect(isWithinPostingWindow(sp(7, 22), w)).toBe(false);
    expect(isWithinPostingWindow(sp(6, 1), w)).toBe(false);
  });

  it('só fim de semana: segunda pula para sábado', () => {
    const w = { startMinute: 480, endMinute: 1200, weekdaysMask: weekdaysMask([SAT, SUN]) };
    expect(resolveStartWithinPostingWindow(sp(9, 10), w)).toEqual(sp(14, 8));
    expect(resolveStartWithinPostingWindow(sp(6, 23, 59), w)).toEqual(sp(7, 8));
    expect(resolveStartWithinPostingWindow(sp(7, 9), w)).toEqual(sp(7, 9));
    // domingo depois do fim → próximo sábado
    expect(resolveStartWithinPostingWindow(sp(8, 21), w)).toEqual(sp(14, 8));
  });

  it('só o dia de hoje, já fechado → mesma hora daqui a 7 dias', () => {
    const w = { startMinute: 480, endMinute: 600, weekdaysMask: weekdaysMask([FRI]) };
    expect(resolveStartWithinPostingWindow(sp(6, 11), w)).toEqual(sp(13, 8));
  });

  it('dia inteiro em dia fora do mask → meia-noite do próximo dia válido', () => {
    const w = { startMinute: 0, endMinute: 1440, weekdaysMask: weekdaysMask([MON]) };
    expect(resolveStartWithinPostingWindow(sp(6, 10), w)).toEqual(sp(9, 0));
  });

  it('noturna fora do mask: madrugada de domingo espera sexta 22h', () => {
    const w = { startMinute: 1320, endMinute: 120, weekdaysMask: weekdaysMask([FRI]) };
    expect(resolveStartWithinPostingWindow(sp(8, 1), w)).toEqual(sp(13, 22));
    expect(resolveStartWithinPostingWindow(sp(7, 1), w)).toEqual(sp(7, 1));
  });

  it('todos os dias = comportamento do operatingWindow', () => {
    const w = { startMinute: 480, endMinute: 1200, weekdaysMask: ALL_WEEKDAYS_MASK };
    expect(resolveStartWithinPostingWindow(sp(6, 6), w)).toEqual(sp(6, 8));
    expect(resolveStartWithinPostingWindow(sp(6, 21), w)).toEqual(sp(7, 8));
  });
});
