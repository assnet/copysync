import { describe, expect, it } from 'vitest';
import { captureExpiresAt, DEFAULT_MONITOR_SETTINGS, monitorSettingsProblem, normalizeKeywords } from './monitorSettings';

const s = (o = {}) => ({ ...DEFAULT_MONITOR_SETTINGS, ...o });

describe('monitorSettingsProblem', () => {
  it('padrão é válido; noturna é válida', () => {
    expect(monitorSettingsProblem(s())).toBeNull();
    expect(monitorSettingsProblem(s({ windowStartMinute: 1320, windowEndMinute: 360 }))).toBeNull();
    // noturna encostada nos extremos (o painel manda assim)
    expect(monitorSettingsProblem(s({ windowStartMinute: 1440, windowEndMinute: 360 }))).toBeNull();
    expect(monitorSettingsProblem(s({ windowStartMinute: 1320, windowEndMinute: 0 }))).toBeNull();
  });
  it.each([
    [{ windowStartMinute: 600, windowEndMinute: 600 }, 'windowEndMinute'],
    [{ windowStartMinute: 1440, windowEndMinute: 0 }, 'windowEndMinute'],
    [{ intervalMinSeconds: 30 }, 'intervalMinSeconds'],
    [{ intervalMinSeconds: 400, intervalMaxSeconds: 300 }, 'intervalMaxSeconds'],
    [{ couponMaxAgeMinutes: 200 }, 'couponMaxAgeMinutes'],
    [{ typingSeconds: 0 }, 'typingSeconds'],
    [{ startDelaySeconds: 1.5 }, 'startDelaySeconds'],
  ])('%o → %s', (o, field) => {
    expect(monitorSettingsProblem(s(o))?.field).toBe(field);
  });
});

describe('captureExpiresAt', () => {
  it('cupom usa a validade menor', () => {
    const at = new Date('2026-10-28T12:00:00Z');
    expect(captureExpiresAt(at, true, s())).toEqual(new Date('2026-10-28T13:00:00Z'));
    expect(captureExpiresAt(at, false, s())).toEqual(new Date('2026-10-28T15:00:00Z'));
  });
});

describe('normalizeKeywords', () => {
  it('limpa vazias e repetidas', () => {
    expect(normalizeKeywords([' fone ', '', 'FONE', 'tv'])).toEqual(['fone', 'tv']);
  });
});
