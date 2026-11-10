import { effectiveImageMode } from '@/features/offers/utils/offerConfig';
import type { GroupMonitorSettings, MonitorTextMode, OfferAudience, OfferImageMode } from '@/types/api.types';
import {
  ALL_WEEKDAYS_MASK, isWeekdaysMaskValid, maskToWeekdays, weekdaysToMask, windowFromSettings, windowToSettings,
  type OperatingWindow,
} from './operatingWindow';

/**
 * Rascunho do formulário. Guarda as unidades da API (segundos) para não arredondar o que o usuário
 * não mexeu: 90 s aparece como "2 min" no slider, mas só vira 120 s se ele mover aquele cursor.
 * A janela fica no formato do slider (`lo <= hi` + noturna); os dias, como `weekdaysMask`
 * (bit 0 = domingo; 127 = todos), o formato do `PostingWindowField`.
 */
export interface MonitorSettingsDraft {
  enabled: boolean;
  window: OperatingWindow;
  weekdaysMask: number;
  intervalMinSeconds: number;
  intervalMaxSeconds: number;
  startDelaySeconds: number;
  maxOfferAgeMinutes: number;
  couponMaxAgeMinutes: number;
  mentionAll: boolean;
  imageMode: OfferImageMode;
  simulateTyping: boolean;
  typingSeconds: number;
  textMode: MonitorTextMode;
  audience: OfferAudience;
  enrichLinkOnly: boolean;
  captureOutsideWindow: boolean;
}

/** Mude ao alterar `MonitorSettingsDraft`: rascunho salvo em outro formato é descartado. */
export const SETTINGS_DRAFT_VERSION = 6;

export const LIMITS = {
  intervalMinutes: { min: 0, max: 60 },
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

/** Lista da API → mask; ausente (API antiga) ou vazia/inválida = todos os dias, o comportamento de antes. */
function weekdaysFromSettings(weekdays: readonly number[] | undefined): number {
  const mask = weekdays ? weekdaysToMask(weekdays) : ALL_WEEKDAYS_MASK;
  return isWeekdaysMaskValid(mask) ? mask : ALL_WEEKDAYS_MASK;
}

/** Igualdade de um campo no formato da API (`weekdays` é lista; o resto, primitivo). */
const sameField = (a: unknown, b: unknown) =>
  Array.isArray(a) && Array.isArray(b) ? a.length === b.length && a.every((v, i) => v === b[i]) : a === b;

export function settingsToDraft(s: GroupMonitorSettings): MonitorSettingsDraft {
  return {
    enabled: s.enabled,
    window: windowFromSettings(s.windowStartMinute, s.windowEndMinute),
    weekdaysMask: weekdaysFromSettings(s.weekdays),
    intervalMinSeconds: s.intervalMinSeconds,
    intervalMaxSeconds: s.intervalMaxSeconds,
    startDelaySeconds: s.startDelaySeconds,
    maxOfferAgeMinutes: s.maxOfferAgeMinutes,
    couponMaxAgeMinutes: s.couponMaxAgeMinutes,
    mentionAll: s.mentionAll,
    // Ausente (API anterior) ou indisponível (imagem com legenda desligada): vale o padrão
    imageMode: effectiveImageMode(s.imageMode),
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
    weekdays: maskToWeekdays(d.weekdaysMask),
    intervalMinSeconds: d.intervalMinSeconds,
    intervalMaxSeconds: d.intervalMaxSeconds,
    startDelaySeconds: d.startDelaySeconds,
    maxOfferAgeMinutes: d.maxOfferAgeMinutes,
    couponMaxAgeMinutes: Math.min(d.couponMaxAgeMinutes, d.maxOfferAgeMinutes),
    mentionAll: d.mentionAll,
    imageMode: d.imageMode,
    simulateTyping: d.simulateTyping,
    typingSeconds: d.typingSeconds,
    textMode: d.textMode,
    // Público só faz sentido com IA; fora dela volta ao padrão para não salvar escolha invisível
    audience: d.textMode === 'AI' ? d.audience : 'STANDARD',
    enrichLinkOnly: d.enrichLinkOnly,
    captureOutsideWindow: d.captureOutsideWindow,
  };
}

/** Recursos liberados pelo plano; `false` trava (ausente = liberado). */
export interface PlanGates {
  mentionAll?: boolean;
  enrichLinkOnly?: boolean;
  captureOutsideWindow?: boolean;
  /** "Reescrita com IA" (PRO/MAX): travada, o modo IA vale como Modelo. */
  aiRewrite?: boolean;
}

/**
 * Valor que vale de fato: recurso travado pelo plano ("mencionar todos", "montar só com link", "capturar fora do horário") conta
 * como desligado — é o que a tela mostra e o que se salva.
 */
export function effectiveDraft(d: MonitorSettingsDraft, gates: PlanGates = {}): MonitorSettingsDraft {
  const mentionAll = gates.mentionAll !== false && d.mentionAll;
  const enrichLinkOnly = gates.enrichLinkOnly !== false && d.enrichLinkOnly;
  const captureOutsideWindow = gates.captureOutsideWindow !== false && d.captureOutsideWindow;
  // IA travada pelo plano: o servidor monta pelo Modelo, então a tela mostra e salva Modelo
  const textMode: MonitorTextMode = gates.aiRewrite === false && d.textMode === 'AI' ? 'TEMPLATE' : d.textMode;
  return mentionAll === d.mentionAll && enrichLinkOnly === d.enrichLinkOnly && captureOutsideWindow === d.captureOutsideWindow
    && textMode === d.textMode
    ? d
    : { ...d, mentionAll, enrichLinkOnly, captureOutsideWindow, textMode };
}

/** Rascunho difere do salvo? Compara no formato da API, com os dois lados no valor efetivo. */
export function isDraftDirty(draft: MonitorSettingsDraft | null, saved: GroupMonitorSettings, gates: PlanGates = {}): boolean {
  if (!draft) return false;
  const a = draftToSettings(effectiveDraft(draft, gates));
  const b = draftToSettings(effectiveDraft(settingsToDraft(saved), gates));
  return (Object.keys(a) as (keyof GroupMonitorSettings)[]).some((k) => !sameField(a[k], b[k]));
}

/** Ordem dos modos de texto no seletor (radiogroup): é também a ordem das setas. */
export const TEXT_MODES: readonly MonitorTextMode[] = ['ORIGINAL', 'TEMPLATE', 'AI'];

/**
 * Modo escolhido pela tecla no radiogroup (padrão WAI-ARIA: setas circulam, Home/End vão às
 * pontas). `null` = tecla não muda a seleção.
 */
export function textModeForKey(
  current: MonitorTextMode,
  key: string,
  /** Modos travados pelo plano: as setas pulam por cima deles. */
  locked: readonly MonitorTextMode[] = [],
): MonitorTextMode | null {
  const modes = TEXT_MODES.filter((m) => !locked.includes(m));
  const n = modes.length;
  if (n === 0) return null;
  const i = Math.max(0, modes.indexOf(current));
  switch (key) {
    case 'ArrowRight':
    case 'ArrowDown':
      return modes[(i + 1) % n]!;
    case 'ArrowLeft':
    case 'ArrowUp':
      return modes[(i - 1 + n) % n]!;
    case 'Home':
      return modes[0]!;
    case 'End':
      return modes[n - 1]!;
    default:
      return null;
  }
}

/** Motivos que a API aceita reprocessar ("Tentar de novo" depois de corrigir a causa). */
export const RETRYABLE_REASONS = ['CREDENTIAL_MISSING', 'CREDENTIAL_REJECTED', 'LINK_RESOLVE_FAILED', 'NO_BROADCAST_GROUPS', 'MONITOR_DISABLED', 'INTERNAL_ERROR'] as const;
