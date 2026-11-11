import { describe, it, expect } from 'vitest';
import {
  InvalidWorkerScalingSettingsError,
  WorkerScalingSettingsConflictError,
} from '../../../../shared/errors/internal/WorkerScalingErrors';
import {
  WORKER_SCALING_FIELDS,
  WORKER_SCALING_RANGES,
  assertReplicaRange,
  defaultWorkerScalingSettings,
  parseWorkerScalingSettings,
  resolveEffectiveSettings,
} from './workerScalingSettings';

const env = { maxSessionsPerWorker: 40, maxPendingLoginsPerWorker: 50 };

function fieldOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(InvalidWorkerScalingSettingsError);
    const err = e as InvalidWorkerScalingSettingsError;
    expect(err.code).toBe('INVALID_WORKER_SCALING_SETTINGS');
    expect(err.statusCode).toBe(400);
    expect(err.meta).toEqual({ field: err.field });
    return err.field;
  }
  return undefined;
}

describe('parseWorkerScalingSettings — faixas', () => {
  const cases: Array<[keyof typeof WORKER_SCALING_RANGES, number, number, number, number]> = [
    // campo, mín, máx, abaixo, acima
    ['maxSessionsPerWorker', 1, 1000, 0, 1001],
    ['maxPendingLoginsPerWorker', 1, 500, 0, 501],
    ['alertOccupancyRatio', 0.5, 0.95, 0.49, 0.96],
    ['awaitingAlertSeconds', 30, 3600, 29, 3601],
    ['minReplicas', 1, 20, 0, 21],
    ['maxReplicas', 1, 20, 0, 21],
    ['scaleUpSustainSeconds', 300, 3600, 299, 3601],
    ['scaleCooldownSeconds', 300, 86400, 299, 86401],
  ];

  it.each(cases)('%s aceita mín e máx e rejeita fora', (field, min, max, below, above) => {
    expect(WORKER_SCALING_RANGES[field]).toMatchObject({ min, max });
    expect(parseWorkerScalingSettings({ [field]: min })).toEqual({ [field]: min });
    expect(parseWorkerScalingSettings({ [field]: max })).toEqual({ [field]: max });
    expect(fieldOf(() => parseWorkerScalingSettings({ [field]: below }))).toBe(field);
    expect(fieldOf(() => parseWorkerScalingSettings({ [field]: above }))).toBe(field);
  });

  it('rejeita string numérica, NaN, Infinity e fração em campo inteiro', () => {
    expect(fieldOf(() => parseWorkerScalingSettings({ maxSessionsPerWorker: '40' }))).toBe('maxSessionsPerWorker');
    expect(fieldOf(() => parseWorkerScalingSettings({ minReplicas: Number.NaN }))).toBe('minReplicas');
    expect(fieldOf(() => parseWorkerScalingSettings({ maxReplicas: Infinity }))).toBe('maxReplicas');
    expect(fieldOf(() => parseWorkerScalingSettings({ awaitingAlertSeconds: 60.5 }))).toBe('awaitingAlertSeconds');
  });

  it('ratio aceita fração dentro da faixa', () => {
    expect(parseWorkerScalingSettings({ alertOccupancyRatio: 0.75 })).toEqual({ alertOccupancyRatio: 0.75 });
  });

  it('scalerMode só off|manual|auto', () => {
    for (const mode of ['off', 'manual', 'auto']) {
      expect(parseWorkerScalingSettings({ scalerMode: mode })).toEqual({ scalerMode: mode });
    }
    expect(fieldOf(() => parseWorkerScalingSettings({ scalerMode: 'AUTO' }))).toBe('scalerMode');
    expect(fieldOf(() => parseWorkerScalingSettings({ scalerMode: 1 }))).toBe('scalerMode');
  });

  it('rejeita campo desconhecido com o nome dele', () => {
    expect(fieldOf(() => parseWorkerScalingSettings({ minReplicas: 1, foo: 1 }))).toBe('foo');
  });

  it('rejeita entrada que não é objeto', () => {
    for (const bad of [null, 'x', 3, [1]]) {
      expect(fieldOf(() => parseWorkerScalingSettings(bad))).toBe('settings');
    }
  });

  it('maxReplicas < minReplicas é erro em maxReplicas; igual é aceito', () => {
    expect(fieldOf(() => parseWorkerScalingSettings({ minReplicas: 3, maxReplicas: 2 }))).toBe('maxReplicas');
    expect(parseWorkerScalingSettings({ minReplicas: 3, maxReplicas: 3 })).toEqual({ minReplicas: 3, maxReplicas: 3 });
    expect(fieldOf(() => assertReplicaRange({ minReplicas: 5, maxReplicas: 4 }))).toBe('maxReplicas');
    expect(() => assertReplicaRange({ minReplicas: 4, maxReplicas: 5 })).not.toThrow();
  });

  it('aceita o objeto completo', () => {
    const full = defaultWorkerScalingSettings(env);
    expect(parseWorkerScalingSettings(full)).toEqual(full);
  });
});

describe('resolveEffectiveSettings', () => {
  it('sem linha salva: defaults de hoje e origem default em todos os campos', () => {
    const r = resolveEffectiveSettings(null, env);
    expect(r.value).toEqual({
      maxSessionsPerWorker: 40,
      maxPendingLoginsPerWorker: 50,
      alertOccupancyRatio: 0.8,
      awaitingAlertSeconds: 120,
      scalerMode: 'off',
      minReplicas: 1,
      maxReplicas: 1,
      scaleUpSustainSeconds: 900,
      scaleCooldownSeconds: 1800,
    });
    for (const f of WORKER_SCALING_FIELDS) expect(r.origin[f]).toBe('default');
  });

  it('salvo vence o default campo a campo', () => {
    const r = resolveEffectiveSettings({ maxSessionsPerWorker: 80, scalerMode: 'manual' }, env);
    expect(r.value.maxSessionsPerWorker).toBe(80);
    expect(r.value.scalerMode).toBe('manual');
    expect(r.value.maxPendingLoginsPerWorker).toBe(50);
    expect(r.origin.maxSessionsPerWorker).toBe('saved');
    expect(r.origin.scalerMode).toBe('saved');
    expect(r.origin.maxPendingLoginsPerWorker).toBe('default');
    expect(r.origin.alertOccupancyRatio).toBe('default');
  });

  it('objeto vazio salvo = tudo default', () => {
    const r = resolveEffectiveSettings({}, env);
    for (const f of WORKER_SCALING_FIELDS) expect(r.origin[f]).toBe('default');
  });

  it('só minReplicas salvo acima do max default: max acompanha o min', () => {
    const r = resolveEffectiveSettings({ minReplicas: 3 }, env);
    expect(r.value.minReplicas).toBe(3);
    expect(r.value.maxReplicas).toBe(3);
  });

  it('não muta o objeto salvo', () => {
    const saved = { minReplicas: 2 };
    resolveEffectiveSettings(saved, env);
    expect(saved).toEqual({ minReplicas: 2 });
  });
});

describe('WorkerScalingSettingsConflictError', () => {
  it('409 com código estável', () => {
    const e = new WorkerScalingSettingsConflictError();
    expect(e.statusCode).toBe(409);
    expect(e.code).toBe('WORKER_SCALING_SETTINGS_CONFLICT');
  });
});
