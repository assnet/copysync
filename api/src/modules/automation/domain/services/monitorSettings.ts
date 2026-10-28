import type { GroupMonitorSettings } from '../entities/GroupMonitor';
import { MINUTES_PER_DAY } from './operatingWindow';

export const MONITOR_LIMITS = {
  intervalSeconds: { min: 60, max: 3600 },
  startDelaySeconds: { min: 0, max: 7200 },
  offerAgeMinutes: { min: 15, max: 1440 },
  typingSeconds: { min: 1, max: 30 },
  /** Teto técnico por sessão (o plano costuma ser menor). */
  groupsPerSession: 100,
  keywordsPerGroup: 20,
  keywordLength: 40,
} as const;

/** Padrões (espelham os `@default` do Prisma): 06:00–18:00 e 15–40 min entre envios. */
export const DEFAULT_MONITOR_SETTINGS: GroupMonitorSettings = {
  enabled: false,
  windowStartMinute: 6 * 60,
  windowEndMinute: 18 * 60,
  intervalMinSeconds: 15 * 60,
  intervalMaxSeconds: 40 * 60,
  startDelaySeconds: 0,
  maxOfferAgeMinutes: 180,
  couponMaxAgeMinutes: 60,
  mentionAll: false,
  simulateTyping: false,
  typingSeconds: 15,
};

const inRange = (v: number, r: { min: number; max: number }) => Number.isInteger(v) && v >= r.min && v <= r.max;

/** Primeiro problema encontrado (`field` + motivo), ou null. Faixas espelham o painel. */
export function monitorSettingsProblem(s: GroupMonitorSettings): { field: keyof GroupMonitorSettings; reason: string } | null {
  const minute = { min: 0, max: MINUTES_PER_DAY };
  if (!inRange(s.windowStartMinute, minute)) return { field: 'windowStartMinute', reason: 'out of range' };
  if (!inRange(s.windowEndMinute, minute)) return { field: 'windowEndMinute', reason: 'out of range' };
  // 1440 = meia-noite seguinte: início 1440 com fim 360 é a janela 00:00–06:00 (noturna encostada)
  const full = s.windowStartMinute === 0 && s.windowEndMinute === MINUTES_PER_DAY;
  if (!full && s.windowStartMinute % MINUTES_PER_DAY === s.windowEndMinute % MINUTES_PER_DAY) {
    return { field: 'windowEndMinute', reason: 'empty window' };
  }
  if (!inRange(s.intervalMinSeconds, MONITOR_LIMITS.intervalSeconds)) return { field: 'intervalMinSeconds', reason: 'out of range' };
  if (!inRange(s.intervalMaxSeconds, MONITOR_LIMITS.intervalSeconds)) return { field: 'intervalMaxSeconds', reason: 'out of range' };
  if (s.intervalMinSeconds > s.intervalMaxSeconds) return { field: 'intervalMaxSeconds', reason: 'max below min' };
  if (!inRange(s.startDelaySeconds, MONITOR_LIMITS.startDelaySeconds)) return { field: 'startDelaySeconds', reason: 'out of range' };
  if (!inRange(s.maxOfferAgeMinutes, MONITOR_LIMITS.offerAgeMinutes)) return { field: 'maxOfferAgeMinutes', reason: 'out of range' };
  if (!inRange(s.couponMaxAgeMinutes, MONITOR_LIMITS.offerAgeMinutes)) return { field: 'couponMaxAgeMinutes', reason: 'out of range' };
  // Cupom vence antes: nunca recebe validade maior que a oferta sem cupom
  if (s.couponMaxAgeMinutes > s.maxOfferAgeMinutes) return { field: 'couponMaxAgeMinutes', reason: 'longer than offer validity' };
  if (!inRange(s.typingSeconds, MONITOR_LIMITS.typingSeconds)) return { field: 'typingSeconds', reason: 'out of range' };
  return null;
}

/** Validade da captura: com cupom a janela é menor. */
export function captureExpiresAt(capturedAt: Date, hasCoupon: boolean, s: Pick<GroupMonitorSettings, 'maxOfferAgeMinutes' | 'couponMaxAgeMinutes'>): Date {
  const minutes = hasCoupon ? s.couponMaxAgeMinutes : s.maxOfferAgeMinutes;
  return new Date(capturedAt.getTime() + minutes * 60_000);
}

/** Palavras-chave limpas: sem vazias/repetidas, cortadas no tamanho máximo. */
export function normalizeKeywords(keywords: readonly string[]): string[] {
  const out: string[] = [];
  for (const k of keywords) {
    const v = k.trim().slice(0, MONITOR_LIMITS.keywordLength);
    if (v && !out.some((o) => o.toLowerCase() === v.toLowerCase())) out.push(v);
  }
  return out.slice(0, MONITOR_LIMITS.keywordsPerGroup);
}
