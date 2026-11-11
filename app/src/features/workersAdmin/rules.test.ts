import { describe, expect, it } from 'vitest';
import {
  WORKER_SETTINGS_LIMITS, diffSettings, draftToSettings, occupancyLevel, occupancyPercent, sortWorkers,
  parseDraftNumber, validateSettingsDraft,
} from './rules';
import { workersAdminStrings } from './strings';
import type { WorkerScalingSettings } from './types';

describe('occupancyPercent', () => {
  it('arredonda e limita a 0–100', () => {
    expect(occupancyPercent(1, 3)).toBe(33);
    expect(occupancyPercent(50, 40)).toBe(100);
    expect(occupancyPercent(0, 40)).toBe(0);
  });
  it('teto 0: cheio com sessão, vazio sem', () => {
    expect(occupancyPercent(2, 0)).toBe(100);
    expect(occupancyPercent(0, 0)).toBe(0);
  });
});

describe('occupancyLevel', () => {
  it('faixas ok / atenção / cheio', () => {
    expect(occupancyLevel(31, 40)).toBe('ok');
    expect(occupancyLevel(32, 40)).toBe('warning');
    expect(occupancyLevel(40, 40)).toBe('full');
  });
});

describe('sortWorkers', () => {
  it('mais ocupado primeiro, empate pelo id', () => {
    const list = [
      { workerId: 'b', sessions: 1, maxSessions: 10 },
      { workerId: 'c', sessions: 9, maxSessions: 10 },
      { workerId: 'a', sessions: 1, maxSessions: 10 },
    ];
    expect(sortWorkers(list).map((w) => w.workerId)).toEqual(['c', 'a', 'b']);
  });
});

describe('validateSettingsDraft', () => {
  const valid: WorkerScalingSettings = {
    maxSessionsPerWorker: 40, maxPendingLoginsPerWorker: 10, alertOccupancyRatio: 0.8,
    awaitingAlertSeconds: 120, scalerMode: 'off', minReplicas: 1, maxReplicas: 3,
    scaleUpSustainSeconds: 600, scaleCooldownSeconds: 900,
  };
  const e = workersAdminStrings.settings.errors;

  it('rascunho válido não tem erro (aceita texto com vírgula)', () => {
    expect(validateSettingsDraft(valid)).toEqual({});
    expect(validateSettingsDraft({ ...valid, alertOccupancyRatio: '0,75', maxSessionsPerWorker: '50' })).toEqual({});
  });

  const cases: [keyof typeof WORKER_SETTINGS_LIMITS, number, number][] = [
    ['maxSessionsPerWorker', 1, 1000],
    ['maxPendingLoginsPerWorker', 1, 500],
    ['alertOccupancyRatio', 0.5, 0.95],
    ['awaitingAlertSeconds', 30, 3600],
    ['minReplicas', 1, 1],
    ['maxReplicas', 3, 20],
    ['scaleUpSustainSeconds', 300, 3600],
    ['scaleCooldownSeconds', 300, 86400],
  ];
  it.each(cases)('%s aceita limites e recusa fora da faixa', (field, min, max) => {
    expect(validateSettingsDraft({ ...valid, [field]: min })[field]).toBeUndefined();
    expect(validateSettingsDraft({ ...valid, [field]: max })[field]).toBeUndefined();
    const lim = WORKER_SETTINGS_LIMITS[field];
    const step = lim.integer ? 1 : 0.01;
    expect(validateSettingsDraft({ ...valid, [field]: lim.min - step })[field]).toMatch(/^Use um valor entre/);
    expect(validateSettingsDraft({ ...valid, [field]: lim.max + step })[field]).toMatch(/^Use um valor entre/);
  });

  it('vazio, não numérico e decimal em campo inteiro', () => {
    expect(validateSettingsDraft({ ...valid, awaitingAlertSeconds: ' ' }).awaitingAlertSeconds).toBe(e.required);
    expect(validateSettingsDraft({ ...valid, maxSessionsPerWorker: 'abc' }).maxSessionsPerWorker).toBe(e.number);
    expect(validateSettingsDraft({ ...valid, alertOccupancyRatio: 'x' }).alertOccupancyRatio).toBe(e.number);
    expect(validateSettingsDraft({ ...valid, minReplicas: 1.5 }).minReplicas).toBe(e.integer);
    expect(validateSettingsDraft({ ...valid, maxReplicas: Number.NaN }).maxReplicas).toBe(e.number);
    expect(validateSettingsDraft({ ...valid, minReplicas: '1,5' }).minReplicas).toBe(e.integer);
  });

  it('parseDraftNumber: só dígitos com um separador; milhar em campo inteiro', () => {
    expect(parseDraftNumber(' 1.000 ', true)).toBe(1000);
    expect(parseDraftNumber('1,000', true)).toBe(1000);
    expect(parseDraftNumber('1.000')).toBe(1);
    expect(parseDraftNumber('1.5', true)).toBe(1.5);
    expect(parseDraftNumber('0,8')).toBe(0.8);
    expect(parseDraftNumber('0.8')).toBe(0.8);
    for (const bad of ['0x10', '1e3', '-1', '+5', '1.000.000', '1,2,3', '.5', '5.', 'Infinity', '1 000', '']) {
      expect(parseDraftNumber(bad, true)).toBeNull();
    }
  });

  it('texto fora do formato vira "Use um número"; "1.000" no teto vale 1000', () => {
    expect(validateSettingsDraft({ ...valid, maxSessionsPerWorker: '0x10' }).maxSessionsPerWorker).toBe(e.number);
    expect(validateSettingsDraft({ ...valid, alertOccupancyRatio: '0,8' })).toEqual({});
    expect(validateSettingsDraft({ ...valid, maxSessionsPerWorker: '1.000' })).toEqual({});
    expect(draftToSettings({ ...valid, maxSessionsPerWorker: '1.000', scaleCooldownSeconds: '86.400' }))
      .toEqual({ ...valid, maxSessionsPerWorker: 1000, scaleCooldownSeconds: 86400 });
  });

  it('máximo de réplicas abaixo do mínimo', () => {
    expect(validateSettingsDraft({ ...valid, minReplicas: 5, maxReplicas: 4 }).maxReplicas).toBe(e.maxBelowMin);
    expect(validateSettingsDraft({ ...valid, minReplicas: 4, maxReplicas: 4 })).toEqual({});
  });

  it('modo de escala desconhecido', () => {
    const draft = { ...valid, scalerMode: 'turbo' as unknown as WorkerScalingSettings['scalerMode'] };
    expect(validateSettingsDraft(draft).scalerMode).toBe(e.scalerMode);
  });

  it('draftToSettings converte texto em número', () => {
    expect(draftToSettings({ ...valid, alertOccupancyRatio: '0,9', minReplicas: '2' }))
      .toEqual({ ...valid, alertOccupancyRatio: 0.9, minReplicas: 2 });
  });

  it('cada campo numérico tem rótulo, ajuda e faixa', () => {
    for (const field of Object.keys(WORKER_SETTINGS_LIMITS)) {
      const t = workersAdminStrings.settings.fields[field as keyof typeof WORKER_SETTINGS_LIMITS];
      expect(t.label && t.help && t.range).toBeTruthy();
    }
  });
});

describe('diffSettings', () => {
  const base: WorkerScalingSettings = {
    maxSessionsPerWorker: 40, maxPendingLoginsPerWorker: 10, alertOccupancyRatio: 0.8,
    awaitingAlertSeconds: 120, scalerMode: 'off', minReplicas: 1, maxReplicas: 3,
    scaleUpSustainSeconds: 600, scaleCooldownSeconds: 900,
  };
  it('sem mudança → lista vazia', () => {
    expect(diffSettings(base, { ...base })).toEqual([]);
  });
  it('lista só o que mudou, na ordem dos campos', () => {
    expect(diffSettings(base, { ...base, maxReplicas: 5, scalerMode: 'manual', maxSessionsPerWorker: 60 })).toEqual([
      { field: 'maxSessionsPerWorker', from: 40, to: 60 },
      { field: 'scalerMode', from: 'off', to: 'manual' },
      { field: 'maxReplicas', from: 3, to: 5 },
    ]);
  });
});
