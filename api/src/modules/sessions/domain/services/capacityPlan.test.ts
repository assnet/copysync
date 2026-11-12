import { describe, it, expect } from 'vitest';
import {
  OCCUPANCY_SAMPLE_MAX_AGE_MS,
  canScaleDownTo,
  mbPerSession,
  requiredReplicas,
  shouldScaleUp,
  suggestedMaxSessions,
  type OccupancySample,
} from './capacityPlan';

describe('requiredReplicas', () => {
  it('arredonda para cima', () => {
    expect(requiredReplicas(32, 40, 0.8)).toBe(1);
    expect(requiredReplicas(33, 40, 0.8)).toBe(2);
    expect(requiredReplicas(64, 40, 0.8)).toBe(2);
    expect(requiredReplicas(65, 40, 0.8)).toBe(3);
  });
  it('mínimo 1 sem conectadas ou com entrada inválida', () => {
    expect(requiredReplicas(0, 40, 0.8)).toBe(1);
    expect(requiredReplicas(10, 0, 0.8)).toBe(1);
    expect(requiredReplicas(10, 40, 0)).toBe(1);
    expect(requiredReplicas(Number.NaN, 40, 0.8)).toBe(1);
  });
});

describe('mbPerSession', () => {
  it('divide média de memória pela média de conectadas', () => {
    expect(mbPerSession(400, 20)).toBe(20);
  });
  it('null sem dado ou conectadas ≤ 0', () => {
    expect(mbPerSession(null, 20)).toBeNull();
    expect(mbPerSession(400, null)).toBeNull();
    expect(mbPerSession(400, 0)).toBeNull();
    expect(mbPerSession(400, -1)).toBeNull();
    expect(mbPerSession(0, 10)).toBeNull();
  });
});

describe('suggestedMaxSessions', () => {
  it('floor(0,7 × limite ÷ MB)', () => {
    expect(suggestedMaxSessions(2048, 20)).toBe(71); // 71,68
    expect(suggestedMaxSessions(1000, 7)).toBe(100);
  });
  it('null sem limite ou sem MB por sessão', () => {
    expect(suggestedMaxSessions(null, 20)).toBeNull();
    expect(suggestedMaxSessions(0, 20)).toBeNull();
    expect(suggestedMaxSessions(2048, null)).toBeNull();
    expect(suggestedMaxSessions(2048, 0)).toBeNull();
  });
});

describe('canScaleDownTo', () => {
  it('permite na igualdade e recusa abaixo', () => {
    expect(canScaleDownTo(2, 40, 0.8, 64)).toBe(true);
    expect(canScaleDownTo(2, 40, 0.8, 65)).toBe(false);
    expect(canScaleDownTo(1, 40, 0.8, 0)).toBe(true);
  });
});

describe('shouldScaleUp', () => {
  const now = new Date('2026-11-11T12:00:00Z');
  const settings = { alertOccupancyRatio: 0.8, scaleUpSustainSeconds: 900 }; // 3 amostras
  const ago = (min: number) => new Date(now.getTime() - min * 60_000);
  const sample = (min: number, connected: number, capacity = 100): OccupancySample => ({
    at: ago(min),
    connected,
    capacity,
  });
  const run = (occupancySamples: OccupancySample[], awaiting = 0) =>
    shouldScaleUp({ occupancySamples, awaitingOlderThanThreshold: awaiting, settings, now });

  it('sem amostra → no_samples; com aguardando sobe mesmo assim', () => {
    expect(run([])).toEqual({ scaleUp: null, reason: 'no_samples' });
    expect(run([], 3)).toEqual({ scaleUp: true, reason: 'awaiting' });
  });

  it('última amostra com mais de 10 min → no_samples; exatamente 10 min ainda vale', () => {
    const old = { at: new Date(now.getTime() - OCCUPANCY_SAMPLE_MAX_AGE_MS - 1), connected: 90, capacity: 100 };
    expect(run([old])).toEqual({ scaleUp: null, reason: 'no_samples' });
    expect(run([old], 1)).toEqual({ scaleUp: true, reason: 'awaiting' });
    expect(run([sample(10, 10)])).toEqual({ scaleUp: false, reason: null });
  });

  it('amostra futura não conta como recente', () => {
    const future = { at: new Date(now.getTime() + 60_000), connected: 99, capacity: 100 };
    expect(run([future])).toEqual({ scaleUp: null, reason: 'no_samples' });
  });

  it('todas acima e quantidade mínima → occupancy (ordem livre)', () => {
    expect(run([sample(1, 81), sample(11, 90), sample(6, 85)])).toEqual({ scaleUp: true, reason: 'occupancy' });
  });

  it('uma amostra no limiar (não estritamente acima) impede', () => {
    expect(run([sample(1, 81), sample(6, 80), sample(11, 90)])).toEqual({ scaleUp: false, reason: null });
  });

  it('amostras insuficientes na janela impedem', () => {
    expect(run([sample(1, 90), sample(6, 90)])).toEqual({ scaleUp: false, reason: null });
  });

  it('amostra fora da janela (no início exato) não conta nem atrapalha', () => {
    // 15 min atrás = início da janela, excluído; 20 min abaixo do limiar também fora.
    expect(run([sample(1, 90), sample(6, 90), sample(15, 90), sample(20, 10)])).toEqual({
      scaleUp: false,
      reason: null,
    });
    expect(run([sample(1, 90), sample(6, 90), sample(14, 90), sample(20, 10)])).toEqual({
      scaleUp: true,
      reason: 'occupancy',
    });
  });

  it('capacidade 0 não conta como acima', () => {
    expect(run([sample(1, 5, 0), sample(6, 90), sample(11, 90)])).toEqual({ scaleUp: false, reason: null });
  });

  it('aguardando > 0 sobe com motivo awaiting', () => {
    expect(run([sample(1, 10)], 1)).toEqual({ scaleUp: true, reason: 'awaiting' });
    expect(run([sample(1, 10)], 0)).toEqual({ scaleUp: false, reason: null });
  });

  it('aguardando tem precedência sobre ocupação no motivo', () => {
    expect(run([sample(1, 90), sample(6, 90), sample(11, 90)], 2)).toEqual({ scaleUp: true, reason: 'awaiting' });
  });

  it('janela mínima de 300 s exige 1 amostra', () => {
    const r = shouldScaleUp({
      occupancySamples: [sample(2, 90)],
      awaitingOlderThanThreshold: 0,
      settings: { alertOccupancyRatio: 0.8, scaleUpSustainSeconds: 300 },
      now,
    });
    expect(r).toEqual({ scaleUp: true, reason: 'occupancy' });
  });

  describe('ignoreBefore (início do último intervalo)', () => {
    const all = [sample(1, 90), sample(6, 90), sample(11, 90)];
    const withIgnore = (ignoreBefore: Date | null, awaiting = 0) =>
      shouldScaleUp({ occupancySamples: all, awaitingOlderThanThreshold: awaiting, settings, now, ignoreBefore });

    it('amostras de antes (ou do instante exato) da última subida não contam: a janela recomeça', () => {
      expect(withIgnore(ago(8))).toEqual({ scaleUp: false, reason: null });
      expect(withIgnore(ago(11))).toEqual({ scaleUp: false, reason: null }); // `at` = ignoreBefore descartada
    });

    it('subida antiga (antes da janela) não muda a decisão; null também não', () => {
      expect(withIgnore(ago(30))).toEqual({ scaleUp: true, reason: 'occupancy' });
      expect(withIgnore(null)).toEqual({ scaleUp: true, reason: 'occupancy' });
    });

    it('não vira no_samples e não afeta o aguardando', () => {
      expect(withIgnore(ago(0))).toEqual({ scaleUp: false, reason: null });
      expect(withIgnore(ago(0), 1)).toEqual({ scaleUp: true, reason: 'awaiting' });
    });
  });
});
