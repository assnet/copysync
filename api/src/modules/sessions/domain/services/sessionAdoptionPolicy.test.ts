import { describe, it, expect } from 'vitest';
import {
  ADOPT_BACKOFF_CAP_MIN,
  ADOPT_TICK_MS,
  ALERT_TICK_MS,
  AWAITING_ALERT_MS,
  CAPACITY_ALERT_RATIO,
  HEARTBEAT_MS,
  MAX_ADOPT_ATTEMPTS,
  WORKER_ALIVE_MS,
  adoptBackoffMinutes,
  capacityAlertReason,
  hasCapacity,
} from './sessionAdoptionPolicy';

const LIMITS = { ratio: CAPACITY_ALERT_RATIO, awaitingSeconds: AWAITING_ALERT_MS / 1000 };

describe('sessionAdoptionPolicy', () => {
  it('constantes da ADOPT-02', () => {
    expect(ADOPT_TICK_MS).toBe(5_000);
    expect(MAX_ADOPT_ATTEMPTS).toBe(5);
    expect(ADOPT_BACKOFF_CAP_MIN).toBe(30);
    expect(HEARTBEAT_MS).toBe(20_000);
    expect(WORKER_ALIVE_MS).toBe(90_000);
    expect(CAPACITY_ALERT_RATIO).toBe(0.8);
    expect(AWAITING_ALERT_MS).toBe(120_000);
    expect(ALERT_TICK_MS).toBe(60_000);
  });

  it('backoff 1..6 = 2, 4, 8, 16, 30, 30 min', () => {
    expect([1, 2, 3, 4, 5, 6].map(adoptBackoffMinutes)).toEqual([2, 4, 8, 16, 30, 30]);
  });

  it('backoff com n <= 0 ou inválido vale 1 min', () => {
    expect(adoptBackoffMinutes(0)).toBe(1);
    expect(adoptBackoffMinutes(-3)).toBe(1);
    expect(adoptBackoffMinutes(Number.NaN)).toBe(1);
  });

  it('hasCapacity só abaixo do teto', () => {
    expect(hasCapacity(39, 40)).toBe(true);
    expect(hasCapacity(40, 40)).toBe(false);
    expect(hasCapacity(41, 40)).toBe(false);
    expect(hasCapacity(0, 0)).toBe(false);
  });

  it('80 % exato não alerta; acima alerta por ocupação', () => {
    expect(capacityAlertReason({ ...LIMITS, sessions: 8, maxSessions: 10, awaitingOverMs: null })).toBeNull();
    expect(capacityAlertReason({ ...LIMITS, sessions: 12, maxSessions: 15, awaitingOverMs: null })).toBeNull();
    expect(capacityAlertReason({ ...LIMITS, sessions: 9, maxSessions: 10, awaitingOverMs: null })).toBe('occupancy');
    expect(capacityAlertReason({ ...LIMITS, sessions: 33, maxSessions: 40, awaitingOverMs: null })).toBe('occupancy');
  });

  it('soma de tetos 0 não divide por zero nem alerta por ocupação', () => {
    expect(capacityAlertReason({ ...LIMITS, sessions: 0, maxSessions: 0, awaitingOverMs: null })).toBeNull();
    expect(capacityAlertReason({ ...LIMITS, sessions: 3, maxSessions: 0, awaitingOverMs: null })).toBeNull();
    expect(capacityAlertReason({ ...LIMITS, sessions: 0, maxSessions: 0, awaitingOverMs: 120_001 })).toBe('awaiting');
  });

  it('espera: 2 min exatos não alerta; acima alerta', () => {
    expect(capacityAlertReason({ ...LIMITS, sessions: 1, maxSessions: 10, awaitingOverMs: 120_000 })).toBeNull();
    expect(capacityAlertReason({ ...LIMITS, sessions: 1, maxSessions: 10, awaitingOverMs: 120_001 })).toBe('awaiting');
  });

  it('ocupação tem prioridade sobre espera', () => {
    expect(capacityAlertReason({ ...LIMITS, sessions: 10, maxSessions: 10, awaitingOverMs: 999_999 })).toBe('occupancy');
  });

  it('limiares vêm da entrada: ratio e awaitingSeconds alterados mudam a decisão', () => {
    const base = { sessions: 7, maxSessions: 10, awaitingOverMs: 61_000 };
    expect(capacityAlertReason({ ...base, ratio: 0.8, awaitingSeconds: 120 })).toBeNull();
    expect(capacityAlertReason({ ...base, ratio: 0.6, awaitingSeconds: 120 })).toBe('occupancy');
    expect(capacityAlertReason({ ...base, ratio: 0.7, awaitingSeconds: 120 })).toBeNull();
    expect(capacityAlertReason({ ...base, ratio: 0.8, awaitingSeconds: 60 })).toBe('awaiting');
    expect(capacityAlertReason({ ...base, ratio: 0.8, awaitingSeconds: 61 })).toBeNull();
  });
});
