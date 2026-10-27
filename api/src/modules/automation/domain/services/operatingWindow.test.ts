import { describe, expect, it } from 'vitest';
import { isWithinWindow, minuteOfDayInZone, resolveStartWithinWindow } from './operatingWindow';

// 2026-10-28 12:00 em São Paulo (UTC-3) = 15:00Z
const sp = (hh: number, mm = 0, day = 28) => new Date(Date.UTC(2026, 9, day, hh + 3, mm));

describe('operatingWindow', () => {
  it('minuto do dia no fuso', () => {
    expect(minuteOfDayInZone(sp(9, 30))).toBe(570);
    expect(minuteOfDayInZone(sp(0, 5))).toBe(5);
  });

  it('janela normal e noturna', () => {
    expect(isWithinWindow(600, { startMinute: 480, endMinute: 1200 })).toBe(true);
    expect(isWithinWindow(1200, { startMinute: 480, endMinute: 1200 })).toBe(false);
    expect(isWithinWindow(1380, { startMinute: 1320, endMinute: 360 })).toBe(true);
    expect(isWithinWindow(120, { startMinute: 1320, endMinute: 360 })).toBe(true);
    expect(isWithinWindow(720, { startMinute: 1320, endMinute: 360 })).toBe(false);
    expect(isWithinWindow(0, { startMinute: 0, endMinute: 1440 })).toBe(true);
  });

  it('dentro da janela começa na hora', () => {
    expect(resolveStartWithinWindow(sp(10), { startMinute: 480, endMinute: 1200 })).toEqual(sp(10));
  });

  it('antes da janela espera o início do mesmo dia', () => {
    expect(resolveStartWithinWindow(sp(6), { startMinute: 480, endMinute: 1200 })).toEqual(sp(8));
  });

  it('depois da janela espera o início do dia seguinte', () => {
    expect(resolveStartWithinWindow(sp(21), { startMinute: 480, endMinute: 1200 })).toEqual(sp(8, 0, 29));
  });

  it('janelas encostadas nos extremos', () => {
    expect(isWithinWindow(100, { startMinute: 1440, endMinute: 360 })).toBe(true);
    expect(isWithinWindow(400, { startMinute: 1440, endMinute: 360 })).toBe(false);
    expect(resolveStartWithinWindow(sp(10), { startMinute: 1440, endMinute: 360 })).toEqual(sp(0, 0, 29));
    expect(isWithinWindow(1380, { startMinute: 1320, endMinute: 0 })).toBe(true);
    expect(isWithinWindow(10, { startMinute: 1320, endMinute: 0 })).toBe(false);
  });

  it('noturna: tarde espera as 22h do mesmo dia', () => {
    expect(resolveStartWithinWindow(sp(14), { startMinute: 1320, endMinute: 360 })).toEqual(sp(22));
  });
});
