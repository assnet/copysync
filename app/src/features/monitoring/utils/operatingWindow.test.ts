import { describe, expect, it } from 'vitest';
import {
  activeMinutes, formatMinuteOfDay, isFullDay, isWindowValid, parseMinuteOfDay, windowBounds, windowFromSettings, windowToSettings,
} from './operatingWindow';
import { formatDuration } from '../strings';
import { draftToSettings, isDraftDirty, secondsToSliderMinutes, settingsToDraft, sliderMinutesToSeconds } from './settingsDraft';
import type { GroupMonitorSettings } from '@/types/api.types';

describe('minutos ↔ HH:MM', () => {
  it('formata com zero à esquerda e 1440 como 24:00', () => {
    expect(formatMinuteOfDay(0)).toBe('00:00');
    expect(formatMinuteOfDay(375)).toBe('06:15');
    expect(formatMinuteOfDay(1320)).toBe('22:00');
    expect(formatMinuteOfDay(1440)).toBe('24:00');
  });

  it('lê de volta e recusa o inválido', () => {
    expect(parseMinuteOfDay('06:15')).toBe(375);
    expect(parseMinuteOfDay('24:00')).toBe(1440);
    expect(parseMinuteOfDay('24:15')).toBeNull();
    expect(parseMinuteOfDay('12:60')).toBeNull();
    expect(parseMinuteOfDay('abc')).toBeNull();
  });
});

describe('janela noturna', () => {
  it('carregar end < start liga a noturna com o slider em lo <= hi', () => {
    expect(windowFromSettings(1320, 360)).toEqual({ lo: 360, hi: 1320, overnight: true });
    expect(windowFromSettings(480, 1080)).toEqual({ lo: 480, hi: 1080, overnight: false });
  });

  it('salvar com noturna envia start = hi e end = lo', () => {
    expect(windowToSettings({ lo: 360, hi: 1320, overnight: true })).toEqual({ windowStartMinute: 1320, windowEndMinute: 360 });
    expect(windowToSettings({ lo: 480, hi: 1080, overnight: false })).toEqual({ windowStartMinute: 480, windowEndMinute: 1080 });
  });

  it('ida e volta preservam a janela', () => {
    for (const [s, e] of [[1320, 360], [0, 1440], [540, 1020]] as const) {
      expect(windowToSettings(windowFromSettings(s, e))).toEqual({ windowStartMinute: s, windowEndMinute: e });
    }
  });

  it('faixa real e duração', () => {
    const night = { lo: 360, hi: 1320, overnight: true };
    expect(windowBounds(night)).toEqual({ start: 1320, end: 360 });
    expect(activeMinutes(night)).toBe(480);
    expect(formatDuration(activeMinutes(night))).toBe('8 h');
    expect(activeMinutes({ lo: 480, hi: 1110, overnight: false })).toBe(630);
  });

  it('dia inteiro = sem restrição; noturna sem horário livre é inválida', () => {
    expect(isFullDay({ lo: 0, hi: 1440, overnight: false })).toBe(true);
    expect(isWindowValid({ lo: 0, hi: 1440, overnight: true })).toBe(false);
    expect(isWindowValid({ lo: 15, hi: 1440, overnight: true })).toBe(true);
  });
});

describe('formatDuration', () => {
  it('minutos, horas e misto', () => {
    expect(formatDuration(45)).toBe('45 min');
    expect(formatDuration(60)).toBe('1 h');
    expect(formatDuration(510)).toBe('8 h 30 min');
  });
});

describe('rascunho da configuração', () => {
  const saved: GroupMonitorSettings = {
    enabled: true, windowStartMinute: 1320, windowEndMinute: 360, intervalMinSeconds: 300, intervalMaxSeconds: 900,
    startDelaySeconds: 600, maxOfferAgeMinutes: 240, couponMaxAgeMinutes: 60, mentionAll: false, simulateTyping: true, typingSeconds: 5,
  };

  it('converte unidades da API para a tela e de volta', () => {
    const d = settingsToDraft(saved);
    expect(d).toMatchObject({ window: { lo: 360, hi: 1320, overnight: true }, intervalMinSeconds: 300, startDelaySeconds: 600 });
    expect(draftToSettings(d)).toEqual(saved);
  });

  it('segundos fora do minuto exato só mudam se o usuário mexer naquele cursor', () => {
    const b = { min: 1, max: 60 };
    expect(secondsToSliderMinutes(90, b)).toBe(2);
    expect(sliderMinutesToSeconds(2, 90, b)).toBe(90);
    expect(sliderMinutesToSeconds(3, 90, b)).toBe(180);
    const odd = { ...saved, intervalMinSeconds: 90 };
    expect(draftToSettings(settingsToDraft(odd)).intervalMinSeconds).toBe(90);
  });

  it('validade com cupom nunca passa da sem cupom', () => {
    const d = { ...settingsToDraft(saved), maxOfferAgeMinutes: 30, couponMaxAgeMinutes: 120 };
    expect(draftToSettings(d).couponMaxAgeMinutes).toBe(30);
  });

  it('dirty só quando difere do salvo', () => {
    expect(isDraftDirty(null, saved)).toBe(false);
    expect(isDraftDirty(settingsToDraft(saved), saved)).toBe(false);
    expect(isDraftDirty({ ...settingsToDraft(saved), typingSeconds: 6 }, saved)).toBe(true);
  });
});
