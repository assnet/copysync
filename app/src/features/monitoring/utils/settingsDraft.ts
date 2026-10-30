import type { GroupMonitorSettings, MonitorTextMode, OfferAudience } from '@/types/api.types';
import { windowFromSettings, windowToSettings, type OperatingWindow } from './operatingWindow';

/**
 * Rascunho do formulário. Guarda as unidades da API (segundos) para não arredondar o que o usuário
 * não mexeu: 90 s aparece como "2 min" no slider, mas só vira 120 s se ele mover aquele cursor.
 * A janela fica no formato do slider (`lo <= hi` + noturna).
 */
export interface MonitorSettingsDraft {
  enabled: boolean;
  window: OperatingWindow;
  intervalMinSeconds: number;
  intervalMaxSeconds: number;
  startDelaySeconds: number;
  maxOfferAgeMinutes: number;
  couponMaxAgeMinutes: number;
  mentionAll: boolean;
  simulateTyping: boolean;
  typingSeconds: number;
  textMode: MonitorTextMode;
  audience: OfferAudience;
  enrichLinkOnly: boolean;
  captureOutsideWindow: boolean;
}

/** Mude ao alterar `MonitorSettingsDraft`: rascunho salvo em outro formato é descartado. */
export const SETTINGS_DRAFT_VERSION = 4;

export const LIMITS = {
  intervalMinutes: { min: 1, max: 60 },
  typingSeconds: { min: 1, max: 30 },
  startDelayMinutes: { min: 0, max: 120 },
  offerAgeMinutes: { min: 15, max: 1440, step: 15 },
} as const;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Segundos → minutos inteiros mostrados no slider (dentro da escala). */
export function secondsToSliderMinutes(seconds: number, bounds: { min: number; max: number }): number {
  return clamp(Math.round(seconds / 60), bounds.min, bounds.max);
}

/** Minutos vindos do slider → segundos; se o valor mostrado não mudou, mantém os segundos originais. */
export function sliderMinutesToSeconds(minutes: number, previousSeconds: number, bounds: { min: number; max: number }): number {
  return minutes === secondsToSliderMinutes(previousSeconds, bounds) ? previousSeconds : minutes * 60;
}

export function settingsToDraft(s: GroupMonitorSettings): MonitorSettingsDraft {
  return {
    enabled: s.enabled,
    window: windowFromSettings(s.windowStartMinute, s.windowEndMinute),
    intervalMinSeconds: s.intervalMinSeconds,
    intervalMaxSeconds: s.intervalMaxSeconds,
    startDelaySeconds: s.startDelaySeconds,
    maxOfferAgeMinutes: s.maxOfferAgeMinutes,
    couponMaxAgeMinutes: s.couponMaxAgeMinutes,
    mentionAll: s.mentionAll,
    simulateTyping: s.simulateTyping,
    typingSeconds: s.typingSeconds,
    textMode: s.textMode,
    audience: s.audience,
    enrichLinkOnly: s.enrichLinkOnly,
    captureOutsideWindow: s.captureOutsideWindow,
  };
}

export function draftToSettings(d: MonitorSettingsDraft): GroupMonitorSettings {
  return {
    enabled: d.enabled,
    ...windowToSettings(d.window),
    intervalMinSeconds: d.intervalMinSeconds,
    intervalMaxSeconds: d.intervalMaxSeconds,
    startDelaySeconds: d.startDelaySeconds,
    maxOfferAgeMinutes: d.maxOfferAgeMinutes,
    couponMaxAgeMinutes: Math.min(d.couponMaxAgeMinutes, d.maxOfferAgeMinutes),
    mentionAll: d.mentionAll,
    simulateTyping: d.simulateTyping,
    typingSeconds: d.typingSeconds,
    textMode: d.textMode,
    // Público só faz sentido com IA; fora dela volta ao padrão para não salvar escolha invisível
    audience: d.textMode === 'AI' ? d.audience : 'STANDARD',
    enrichLinkOnly: d.enrichLinkOnly,
    captureOutsideWindow: d.captureOutsideWindow,
  };
}

/** Valor que vale de fato: "mencionar todos" travado pelo plano conta como desligado (é o que a tela mostra e o que se salva). */
export function effectiveDraft(d: MonitorSettingsDraft, mentionAllEnabled: boolean): MonitorSettingsDraft {
  return mentionAllEnabled || !d.mentionAll ? d : { ...d, mentionAll: false };
}

/** Rascunho difere do salvo? Compara no formato da API, com os dois lados no valor efetivo. */
export function isDraftDirty(draft: MonitorSettingsDraft | null, saved: GroupMonitorSettings, mentionAllEnabled = true): boolean {
  if (!draft) return false;
  const a = draftToSettings(effectiveDraft(draft, mentionAllEnabled));
  const b = draftToSettings(effectiveDraft(settingsToDraft(saved), mentionAllEnabled));
  return (Object.keys(a) as (keyof GroupMonitorSettings)[]).some((k) => a[k] !== b[k]);
}

/** Ordem dos modos de texto no seletor (radiogroup): é também a ordem das setas. */
export const TEXT_MODES: readonly MonitorTextMode[] = ['ORIGINAL', 'TEMPLATE', 'AI'];

/**
 * Modo escolhido pela tecla no radiogroup (padrão WAI-ARIA: setas circulam, Home/End vão às
 * pontas). `null` = tecla não muda a seleção.
 */
export function textModeForKey(current: MonitorTextMode, key: string): MonitorTextMode | null {
  const i = Math.max(0, TEXT_MODES.indexOf(current));
  const n = TEXT_MODES.length;
  switch (key) {
    case 'ArrowRight':
    case 'ArrowDown':
      return TEXT_MODES[(i + 1) % n]!;
    case 'ArrowLeft':
    case 'ArrowUp':
      return TEXT_MODES[(i - 1 + n) % n]!;
    case 'Home':
      return TEXT_MODES[0]!;
    case 'End':
      return TEXT_MODES[n - 1]!;
    default:
      return null;
  }
}

/** Motivos que a API aceita reprocessar ("Tentar de novo" depois de corrigir a causa). */
export const RETRYABLE_REASONS = ['CREDENTIAL_MISSING', 'CREDENTIAL_REJECTED', 'LINK_RESOLVE_FAILED', 'NO_BROADCAST_GROUPS', 'MONITOR_DISABLED', 'INTERNAL_ERROR'] as const;
