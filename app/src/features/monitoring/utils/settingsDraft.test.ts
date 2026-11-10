import { describe, expect, it } from 'vitest';
import type { GroupMonitorSettings } from '@/types/api.types';
import {
  LIMITS, TEXT_MODES, draftToSettings, effectiveDraft, isDraftDirty, settingsToDraft, sliderMinutesToSeconds, textModeForKey,
} from './settingsDraft';

const saved: GroupMonitorSettings = {
  enabled: false, windowStartMinute: 0, windowEndMinute: 1440, intervalMinSeconds: 90, intervalMaxSeconds: 600,
  startDelaySeconds: 0, maxOfferAgeMinutes: 240, couponMaxAgeMinutes: 60, mentionAll: false, imageMode: 'MEDIA', simulateTyping: true, typingSeconds: 5,
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
    expect(isDraftDirty({ ...settingsToDraft(saved), mentionAll: true }, saved, { mentionAll: false })).toBe(false);
    expect(isDraftDirty({ ...settingsToDraft(saved), mentionAll: true }, { ...saved, mentionAll: true }, { mentionAll: false })).toBe(false);
    expect(isDraftDirty({ ...settingsToDraft(saved), mentionAll: true }, saved, { mentionAll: true })).toBe(true);
  });

  it('formato da imagem: padrão prévia do link; MEDIA salvo vale como prévia (indisponível) e não suja o rascunho', () => {
    const { imageMode: _omit, ...legacy } = saved;
    expect(settingsToDraft(legacy as GroupMonitorSettings).imageMode).toBe('LINK_PREVIEW');
    expect(settingsToDraft(saved).imageMode).toBe('LINK_PREVIEW');
    expect(draftToSettings(settingsToDraft(saved)).imageMode).toBe('LINK_PREVIEW');
    expect(isDraftDirty(settingsToDraft(saved), saved)).toBe(false);
    expect(isDraftDirty({ ...settingsToDraft(saved), imageMode: 'MEDIA' }, { ...saved, imageMode: 'LINK_PREVIEW' })).toBe(true);
  });

  it('"montar oferta só com link" travado pelo plano: rascunho com true não suja; efetivo envia false', () => {
    const draft = settingsToDraft(saved);
    expect(draft.enrichLinkOnly).toBe(true);
    expect(isDraftDirty(draft, saved, { enrichLinkOnly: false })).toBe(false);
    expect(isDraftDirty(draft, { ...saved, enrichLinkOnly: false }, { enrichLinkOnly: false })).toBe(false);
    expect(isDraftDirty(draft, { ...saved, enrichLinkOnly: false }, { enrichLinkOnly: true })).toBe(true);
    expect(draftToSettings(effectiveDraft(draft, { enrichLinkOnly: false })).enrichLinkOnly).toBe(false);
    expect(effectiveDraft(draft, { enrichLinkOnly: true })).toBe(draft);
  });

  it('dias da semana: lista ↔ mask; API sem o campo ou lista vazia = todos; troca suja o rascunho', () => {
    expect(settingsToDraft(saved).weekdaysMask).toBe(127);
    expect(settingsToDraft({ ...saved, weekdays: [] }).weekdaysMask).toBe(127);
    expect(settingsToDraft({ ...saved, weekdays: [5, 1] }).weekdaysMask).toBe(34);
    expect(draftToSettings(settingsToDraft(saved)).weekdays).toEqual([0, 1, 2, 3, 4, 5, 6]);
    const weekdays = { ...saved, weekdays: [1, 2, 3, 4, 5] };
    expect(isDraftDirty(settingsToDraft(weekdays), weekdays)).toBe(false);
    expect(isDraftDirty(settingsToDraft(saved), weekdays)).toBe(true);
    expect(draftToSettings({ ...settingsToDraft(saved), weekdaysMask: 62 }).weekdays).toEqual([1, 2, 3, 4, 5]);
  });
});
