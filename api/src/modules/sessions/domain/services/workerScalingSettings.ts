/**
 * Configuração de escala dos workers (WSCALE-01/02). Faixas, defaults e origem por campo.
 * Funções puras, sem env nem I/O: os valores da env chegam como `envDefaults`.
 * Ver `.specs/features/worker-scaling/spec.md`.
 */
import { InvalidWorkerScalingSettingsError } from '../../../../shared/errors/internal/WorkerScalingErrors';
import { AWAITING_ALERT_MS, CAPACITY_ALERT_RATIO } from './sessionAdoptionPolicy';

export const WORKER_SCALER_MODES = ['off', 'manual', 'auto'] as const;
export type WorkerScalerMode = (typeof WORKER_SCALER_MODES)[number];

export interface WorkerScalingSettings {
  maxSessionsPerWorker: number;
  maxPendingLoginsPerWorker: number;
  alertOccupancyRatio: number;
  awaitingAlertSeconds: number;
  scalerMode: WorkerScalerMode;
  minReplicas: number;
  maxReplicas: number;
  scaleUpSustainSeconds: number;
  scaleCooldownSeconds: number;
}

export type WorkerScalingSettingsField = keyof WorkerScalingSettings;

/** Valor salvo: só os campos gravados (o resto vem do default). */
export type WorkerScalingSettingsPatch = Partial<WorkerScalingSettings>;

export type WorkerScalingSettingsSource = 'default' | 'saved';
export type WorkerScalingSettingsOrigin = Record<WorkerScalingSettingsField, WorkerScalingSettingsSource>;

export interface EffectiveWorkerScalingSettings {
  value: WorkerScalingSettings;
  origin: WorkerScalingSettingsOrigin;
}

/** Valores iniciais vindos da env (`WORKER_MAX_SESSIONS`, `WORKER_MAX_PENDING_LOGINS`). */
export interface WorkerScalingEnvDefaults {
  maxSessionsPerWorker: number;
  maxPendingLoginsPerWorker: number;
}

interface NumericRange {
  min: number;
  max: number;
  integer: boolean;
}

/** Faixas de WSCALE-01 (inclusivas). `maxReplicas` também exige `>= minReplicas`. */
export const WORKER_SCALING_RANGES: Record<Exclude<WorkerScalingSettingsField, 'scalerMode'>, NumericRange> = {
  maxSessionsPerWorker: { min: 1, max: 1000, integer: true },
  maxPendingLoginsPerWorker: { min: 1, max: 500, integer: true },
  alertOccupancyRatio: { min: 0.5, max: 0.95, integer: false },
  awaitingAlertSeconds: { min: 30, max: 3600, integer: true },
  minReplicas: { min: 1, max: 20, integer: true },
  maxReplicas: { min: 1, max: 20, integer: true },
  scaleUpSustainSeconds: { min: 300, max: 3600, integer: true },
  scaleCooldownSeconds: { min: 300, max: 86400, integer: true },
};

export const WORKER_SCALING_FIELDS: readonly WorkerScalingSettingsField[] = [
  'maxSessionsPerWorker',
  'maxPendingLoginsPerWorker',
  'alertOccupancyRatio',
  'awaitingAlertSeconds',
  'scalerMode',
  'minReplicas',
  'maxReplicas',
  'scaleUpSustainSeconds',
  'scaleCooldownSeconds',
];

/** Defaults sem linha salva: o comportamento de hoje (WSCALE-02). */
export function defaultWorkerScalingSettings(envDefaults: WorkerScalingEnvDefaults): WorkerScalingSettings {
  return {
    maxSessionsPerWorker: envDefaults.maxSessionsPerWorker,
    maxPendingLoginsPerWorker: envDefaults.maxPendingLoginsPerWorker,
    alertOccupancyRatio: CAPACITY_ALERT_RATIO,
    awaitingAlertSeconds: AWAITING_ALERT_MS / 1000,
    scalerMode: 'off',
    minReplicas: 1,
    maxReplicas: 1,
    scaleUpSustainSeconds: 900,
    scaleCooldownSeconds: 1800,
  };
}

function parseNumber(field: keyof typeof WORKER_SCALING_RANGES, raw: unknown): number {
  const range = WORKER_SCALING_RANGES[field];
  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    throw new InvalidWorkerScalingSettingsError(field, 'must be a number');
  }
  if (range.integer && !Number.isInteger(raw)) {
    throw new InvalidWorkerScalingSettingsError(field, 'must be an integer');
  }
  if (raw < range.min || raw > range.max) {
    throw new InvalidWorkerScalingSettingsError(field, `must be between ${range.min} and ${range.max}`);
  }
  return raw;
}

/** `maxReplicas >= minReplicas`; erro no campo `maxReplicas`. */
export function assertReplicaRange(settings: Pick<WorkerScalingSettings, 'minReplicas' | 'maxReplicas'>): void {
  if (settings.maxReplicas < settings.minReplicas) {
    throw new InvalidWorkerScalingSettingsError('maxReplicas', 'must be greater than or equal to minReplicas');
  }
}

/**
 * Valida um objeto (parcial ou completo) de configuração. Rejeita campo desconhecido, tipo
 * errado e valor fora da faixa, sempre com o `field`. Sem coerção de string para número.
 * Com `minReplicas` e `maxReplicas` presentes, confere o par; com um só, o par é conferido
 * pelo chamador sobre o valor mesclado (`assertReplicaRange`).
 */
export function parseWorkerScalingSettings(input: unknown): WorkerScalingSettingsPatch {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new InvalidWorkerScalingSettingsError('settings', 'must be an object');
  }
  const out: WorkerScalingSettingsPatch = {};
  for (const [key, raw] of Object.entries(input as Record<string, unknown>)) {
    if (!(WORKER_SCALING_FIELDS as readonly string[]).includes(key)) {
      throw new InvalidWorkerScalingSettingsError(key, 'unknown field');
    }
    const field = key as WorkerScalingSettingsField;
    if (field === 'scalerMode') {
      if (typeof raw !== 'string' || !(WORKER_SCALER_MODES as readonly string[]).includes(raw)) {
        throw new InvalidWorkerScalingSettingsError(field, `must be one of ${WORKER_SCALER_MODES.join(', ')}`);
      }
      out.scalerMode = raw as WorkerScalerMode;
    } else {
      out[field] = parseNumber(field, raw);
    }
  }
  if (out.minReplicas !== undefined && out.maxReplicas !== undefined) {
    assertReplicaRange({ minReplicas: out.minReplicas, maxReplicas: out.maxReplicas });
  }
  return out;
}

/**
 * Valor efetivo: o salvo vence o default campo a campo (WSCALE-02). `saved` já validado
 * (`parseWorkerScalingSettings`); `null` = sem linha salva. Se o salvo deixar
 * `maxReplicas < minReplicas` (ex.: só `minReplicas` gravado), `maxReplicas` sobe para `minReplicas`.
 */
export function resolveEffectiveSettings(
  saved: WorkerScalingSettingsPatch | null,
  envDefaults: WorkerScalingEnvDefaults,
): EffectiveWorkerScalingSettings {
  const defaults = defaultWorkerScalingSettings(envDefaults);
  const value = { ...defaults } as Record<WorkerScalingSettingsField, unknown>;
  const origin = {} as WorkerScalingSettingsOrigin;
  for (const field of WORKER_SCALING_FIELDS) {
    const savedValue = saved?.[field];
    if (savedValue !== undefined) {
      value[field] = savedValue;
      origin[field] = 'saved';
    } else {
      origin[field] = 'default';
    }
  }
  const settings = value as unknown as WorkerScalingSettings;
  if (settings.maxReplicas < settings.minReplicas) settings.maxReplicas = settings.minReplicas;
  return { value: settings, origin };
}
