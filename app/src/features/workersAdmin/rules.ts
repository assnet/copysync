/** Regras puras da tela de workers (sem React). */
import type {
  WorkerScalerMode,
  WorkerScalingSettings,
  WorkerScalingSettingsChange,
  WorkerScalingSettingsDraft,
  WorkerScalingSettingsField,
} from './types';
import { workersAdminStrings } from './strings';

export type OccupancyLevel = 'ok' | 'warning' | 'full';

/** Ocupação em % (0–100, inteiro). Teto 0 conta como cheio se houver sessão. */
export function occupancyPercent(sessions: number, maxSessions: number): number {
  if (maxSessions <= 0) return sessions > 0 ? 100 : 0;
  return Math.min(100, Math.max(0, Math.round((sessions / maxSessions) * 100)));
}

/** Faixa de cor: até 79% ok, 80–99% atenção, 100% cheio. */
export function occupancyLevel(sessions: number, maxSessions: number): OccupancyLevel {
  const pct = occupancyPercent(sessions, maxSessions);
  if (pct >= 100) return 'full';
  return pct >= 80 ? 'warning' : 'ok';
}

/** Ordem da tabela: mais ocupado primeiro, empate pelo id. */
export function sortWorkers<T extends { workerId: string; sessions: number; maxSessions: number }>(list: T[]): T[] {
  return [...list].sort(
    (a, b) => occupancyPercent(b.sessions, b.maxSessions) - occupancyPercent(a.sessions, a.maxSessions)
      || a.workerId.localeCompare(b.workerId),
  );
}

/* ── Configuração de escala (WSCALE-01/07) ───────────────────────────── */

type NumericField = Exclude<WorkerScalingSettingsField, 'scalerMode'>;

/** Faixas aceitas pela API (WSCALE-01). `maxReplicas` também exige ≥ `minReplicas`. */
export const WORKER_SETTINGS_LIMITS: Record<NumericField, { min: number; max: number; integer: boolean }> = {
  maxSessionsPerWorker: { min: 1, max: 1000, integer: true },
  maxPendingLoginsPerWorker: { min: 1, max: 500, integer: true },
  alertOccupancyRatio: { min: 0.5, max: 0.95, integer: false },
  awaitingAlertSeconds: { min: 30, max: 3600, integer: true },
  minReplicas: { min: 1, max: 20, integer: true },
  maxReplicas: { min: 1, max: 20, integer: true },
  scaleUpSustainSeconds: { min: 300, max: 3600, integer: true },
  scaleCooldownSeconds: { min: 300, max: 86400, integer: true },
};

/** Ordem de exibição e de comparação dos campos. */
export const WORKER_SETTINGS_FIELDS: WorkerScalingSettingsField[] = [
  'maxSessionsPerWorker', 'maxPendingLoginsPerWorker', 'alertOccupancyRatio', 'awaitingAlertSeconds',
  'scalerMode', 'minReplicas', 'maxReplicas', 'scaleUpSustainSeconds', 'scaleCooldownSeconds',
];

const SCALER_MODES: WorkerScalerMode[] = ['off', 'manual', 'auto'];
const fmt = (n: number) => n.toLocaleString('pt-BR');

const DRAFT_NUMBER = /^\d+([.,]\d+)?$/;

/**
 * Número do rascunho. Texto aceito: dígitos com no máximo um `.` ou `,` (sem sinal, hexa, expoente).
 * Em campo inteiro, separador seguido de exatamente 3 dígitos é milhar ("1.000" → 1000).
 * Vazio/inválido → `null`.
 */
export function parseDraftNumber(value: number | string, integer = false): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const text = value.trim();
  if (!DRAFT_NUMBER.test(text)) return null;
  if (integer && /^\d+[.,]\d{3}$/.test(text)) return Number(text.replace(/[.,]/, ''));
  return Number(text.replace(',', '.'));
}

/** Erro por campo do rascunho; objeto vazio = válido. */
export function validateSettingsDraft(
  draft: WorkerScalingSettingsDraft,
): Partial<Record<WorkerScalingSettingsField, string>> {
  const e = workersAdminStrings.settings.errors;
  const errors: Partial<Record<WorkerScalingSettingsField, string>> = {};
  for (const field of Object.keys(WORKER_SETTINGS_LIMITS) as NumericField[]) {
    const raw = draft[field];
    if (typeof raw === 'string' && raw.trim() === '') { errors[field] = e.required; continue; }
    const lim = WORKER_SETTINGS_LIMITS[field];
    const n = parseDraftNumber(raw, lim.integer);
    if (n === null) errors[field] = e.number;
    else if (lim.integer && !Number.isInteger(n)) errors[field] = e.integer;
    else if (n < lim.min || n > lim.max) errors[field] = e.range(fmt(lim.min), fmt(lim.max));
  }
  if (!SCALER_MODES.includes(draft.scalerMode)) errors.scalerMode = e.scalerMode;
  if (!errors.minReplicas && !errors.maxReplicas) {
    const min = parseDraftNumber(draft.minReplicas, true) as number;
    const max = parseDraftNumber(draft.maxReplicas, true) as number;
    if (max < min) errors.maxReplicas = e.maxBelowMin;
  }
  return errors;
}

/** Converte rascunho válido no payload; chame só depois de `validateSettingsDraft` vazio. */
export function draftToSettings(draft: WorkerScalingSettingsDraft): WorkerScalingSettings {
  const out = { scalerMode: draft.scalerMode } as WorkerScalingSettings;
  for (const field of Object.keys(WORKER_SETTINGS_LIMITS) as NumericField[]) {
    out[field] = parseDraftNumber(draft[field], WORKER_SETTINGS_LIMITS[field].integer) as number;
  }
  return out;
}

/** Campos que mudam entre `before` e `after`, na ordem de exibição. */
export function diffSettings(
  before: WorkerScalingSettings,
  after: WorkerScalingSettings,
): WorkerScalingSettingsChange[] {
  return WORKER_SETTINGS_FIELDS
    .filter((field) => before[field] !== after[field])
    .map((field) => ({ field, from: before[field], to: after[field] }));
}
