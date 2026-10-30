import { describe, expect, it } from 'vitest';
import type { GroupMonitorSettings } from '@/types/api.types';
import {
  LIMITS, TEXT_MODES, isDraftDirty, settingsToDraft, sliderMinutesToSeconds, textModeForKey,
} from './settingsDraft';

const saved: GroupMonitorSettings = {
  enabled: false, windowStartMinute: 0, windowEndMinute: 1440, intervalMinSeconds: 90, intervalMaxSeconds: 600,
  startDelaySeconds: 0, maxOfferAgeMinutes: 240, couponMaxAgeMinutes: 60, mentionAll: false, simulateTyping: true, typingSeconds: 5,
  textMode: 'ORIGINAL', audience: 'STANDARD', enrichLinkOnly: true, captureOutsideWindow: true,
};

describe('settingsDraft', () => {
  it('setas circulam pelos modos e Home/End vão às pontas', () => {
    expect(TEXT_MODES).toEqual(['ORIGINAL', 'TEMPLATE', 'AI']);
    expect(textModeForKey('ORIGINAL', 'ArrowRight')).toBe('TEMPLATE');
    expect(textModeForKey('AI', 'ArrowDown')).toBe('ORIGINAL');
    expect(textModeForKey('ORIGINAL', 'ArrowLeft')).toBe('AI');
    expect(textModeForKey('TEMPLATE', 'ArrowUp')).toBe('ORIGINAL');
    expect(textModeForKey('TEMPLATE', 'Home')).toBe('ORIGINAL');
    expect(textModeForKey('ORIGINAL', 'End')).toBe('AI');
    expect(textModeForKey('ORIGINAL', 'Enter')).toBeNull();
  });

  it('slider sem mudança preserva os segundos originais (90 s não vira 120 s)', () => {
    expect(sliderMinutesToSeconds(2, 90, LIMITS.intervalMinutes)).toBe(90);
    expect(sliderMinutesToSeconds(3, 90, LIMITS.intervalMinutes)).toBe(180);
  });

  it('rascunho igual ao salvo não está sujo; público fora da IA não conta', () => {
    expect(isDraftDirty(null, saved)).toBe(false);
    expect(isDraftDirty(settingsToDraft(saved), saved)).toBe(false);
    expect(isDraftDirty({ ...settingsToDraft(saved), audience: 'YOUNG' as never }, saved)).toBe(false);
    expect(isDraftDirty({ ...settingsToDraft(saved), textMode: 'AI' }, saved)).toBe(true);
    // "Mencionar todos" travado pelo plano: rascunho antigo com true não vira "não salvo" fantasma
    expect(isDraftDirty({ ...settingsToDraft(saved), mentionAll: true }, saved, false)).toBe(false);
    expect(isDraftDirty({ ...settingsToDraft(saved), mentionAll: true }, { ...saved, mentionAll: true }, false)).toBe(false);
    expect(isDraftDirty({ ...settingsToDraft(saved), mentionAll: true }, saved, true)).toBe(true);
  });
});
