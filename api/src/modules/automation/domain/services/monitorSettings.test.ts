import { describe, expect, it } from 'vitest';
import { captureExpiresAt, DEFAULT_MONITOR_SETTINGS, DEFAULT_MONITOR_WEEKDAYS, monitorSettingsProblem, normalizeKeywords } from './monitorSettings';

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
    [{ intervalMinSeconds: -1 }, 'intervalMinSeconds'],
    [{ intervalMinSeconds: 400, intervalMaxSeconds: 300 }, 'intervalMaxSeconds'],
    [{ maxOfferAgeMinutes: 180, couponMaxAgeMinutes: 200 }, 'couponMaxAgeMinutes'],
    [{ typingSeconds: 0 }, 'typingSeconds'],
    [{ startDelaySeconds: 1.5 }, 'startDelaySeconds'],
    [{ weekdays: [] }, 'weekdays'],
    [{ weekdays: [7] }, 'weekdays'],
    [{ weekdays: [-1, 2] }, 'weekdays'],
    [{ weekdays: [1.5] }, 'weekdays'],
    [{ weekdays: [1, 1] }, 'weekdays'],
  ])('%o → %s', (o, field) => {
    expect(monitorSettingsProblem(s(o))?.field).toBe(field);
  });
});

describe('weekdays', () => {
  it('ausente (cliente anterior), um dia, fim de semana e todos são válidos', () => {
    expect(monitorSettingsProblem(s())).toBeNull();
    expect(monitorSettingsProblem(s({ weekdays: [3] }))).toBeNull();
    expect(monitorSettingsProblem(s({ weekdays: [6, 0] }))).toBeNull();
    expect(monitorSettingsProblem(s({ weekdays: [...DEFAULT_MONITOR_WEEKDAYS] }))).toBeNull();
  });
  it('motivo de cada recusa', () => {
    expect(monitorSettingsProblem(s({ weekdays: [] }))?.reason).toBe('empty');
    expect(monitorSettingsProblem(s({ weekdays: [0, 7] }))?.reason).toBe('out of range');
    expect(monitorSettingsProblem(s({ weekdays: [2, 2] }))?.reason).toBe('duplicate');
  });
  it('janela inválida tem prioridade sobre os dias', () => {
    expect(monitorSettingsProblem(s({ windowStartMinute: 600, windowEndMinute: 600, weekdays: [] }))?.field).toBe('windowEndMinute');
  });
});

describe('captureExpiresAt', () => {
  it('cupom usa a validade menor', () => {
    const at = new Date('2026-10-28T12:00:00Z');
    const v = { maxOfferAgeMinutes: 180, couponMaxAgeMinutes: 60 };
    expect(captureExpiresAt(at, true, v)).toEqual(new Date('2026-10-28T13:00:00Z'));
    expect(captureExpiresAt(at, false, v)).toEqual(new Date('2026-10-28T15:00:00Z'));
  });
});

describe('DEFAULT_MONITOR_SETTINGS', () => {
  it('sem intervalo, "digitando" 3 s, validade 24 h, prévia do link e sem montar só com link', () => {
    expect(DEFAULT_MONITOR_SETTINGS).toMatchObject({
      intervalMinSeconds: 0,
      intervalMaxSeconds: 0,
      maxOfferAgeMinutes: 1440,
      couponMaxAgeMinutes: 1440,
      simulateTyping: true,
      typingSeconds: 3,
      enrichLinkOnly: false,
      imageMode: 'LINK_PREVIEW',
    });
  });
});

describe('normalizeKeywords', () => {
  it('limpa vazias e repetidas', () => {
    expect(normalizeKeywords([' fone ', '', 'FONE', 'tv'])).toEqual(['fone', 'tv']);
  });
});
