import { describe, it, expect } from 'vitest';
import { startOfDayInZone } from './startOfDayInZone';

describe('startOfDayInZone', () => {
  it('madrugada UTC ainda é o dia anterior em São Paulo', () => {
    expect(startOfDayInZone(new Date('2026-10-26T02:30:00Z')).toISOString()).toBe('2026-10-25T03:00:00.000Z');
  });

  it('depois das 03:00Z já é o próprio dia', () => {
    expect(startOfDayInZone(new Date('2026-10-26T15:00:00Z')).toISOString()).toBe('2026-10-26T03:00:00.000Z');
  });

  it('meia-noite exata local é ela mesma', () => {
    expect(startOfDayInZone(new Date('2026-10-26T03:00:00Z')).toISOString()).toBe('2026-10-26T03:00:00.000Z');
  });

  it('respeita outro fuso, inclusive em horário de verão', () => {
    expect(startOfDayInZone(new Date('2026-07-01T12:00:00Z'), 'UTC').toISOString()).toBe('2026-07-01T00:00:00.000Z');
    expect(startOfDayInZone(new Date('2026-07-01T12:00:00Z'), 'Europe/Lisbon').toISOString()).toBe('2026-06-30T23:00:00.000Z');
  });
});
