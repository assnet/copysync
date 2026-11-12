import { describe, expect, it } from 'vitest';
import { matchWorkerInstances, workerIdHostSegments, type WorkerInstanceHeartbeat, type WorkerInstanceSample } from './workerInstancesPolicy';

const SVC = 'srv-dbqhvkrbc2fs73del670';
const NOW = new Date('2026-11-12T12:00:00.000Z');
const ago = (min: number) => new Date(NOW.getTime() - min * 60_000);
const s = (suffix: string, metric: string, value: number, at = ago(1)): WorkerInstanceSample =>
  ({ resource: `${SVC}-${suffix}`, metric, value, at });
const hb = (suffix: string, extra: Partial<WorkerInstanceHeartbeat> = {}): WorkerInstanceHeartbeat => ({
  workerId: `${SVC}-5f44954c7b-${suffix}-19-18faf21d`, sessions: 12, pendingLogins: 1, maxSessions: 40, rssMb: 512, seenAt: ago(0.5), ...extra,
});

describe('workerIdHostSegments', () => {
  it('tira prefixo do serviço, pid e nonce', () => {
    expect(workerIdHostSegments(`${SVC}-5f44954c7b-4lx97-19-18faf21d`, SVC)).toEqual(['5f44954c7b', '4lx97']);
  });
  it('fora do serviço ou sem pid/nonce = null', () => {
    expect(workerIdHostSegments('srv-api-abc-1-ffffffff', SVC)).toBeNull();
    expect(workerIdHostSegments(`${SVC}x-a-b-1-2`, SVC)).toBeNull();
    expect(workerIdHostSegments(`${SVC}-1-2`, SVC)).toBeNull();
  });
});

describe('matchWorkerInstances', () => {
  it('sem serviço worker = vazio', () => {
    expect(matchWorkerInstances(null, [s('4lx97', 'cpu_pct', 10)], [hb('4lx97')])).toEqual([]);
  });

  it('1 instância: amostra casada com o batimento pelo sufixo', () => {
    const out = matchWorkerInstances(SVC, [s('4lx97', 'cpu_pct', 12.5), s('4lx97', 'memory_pct', 61, ago(2))], [hb('4lx97')]);
    expect(out).toEqual([{
      instance: '4lx97', resource: `${SVC}-4lx97`, cpuPct: 12.5, memoryPct: 61, sampledAt: ago(1),
      heartbeat: hb('4lx97'),
    }]);
  });

  it('2 instâncias, cada uma com o seu batimento; outras métricas e serviços ignorados', () => {
    const out = matchWorkerInstances(SVC, [
      s('aaaaa', 'cpu_pct', 30), s('bbbbb', 'cpu_pct', 70), s('aaaaa', 'cpu', 0.3),
      { resource: 'srv-api', metric: 'cpu_pct', value: 99, at: ago(1) },
    ], [hb('bbbbb', { sessions: 7 }), hb('aaaaa', { sessions: 3 }), { ...hb('zzzzz'), workerId: 'srv-api-x-y-1-2' }]);
    expect(out.map((r) => [r.instance, r.cpuPct, r.heartbeat?.sessions])).toEqual([['aaaaa', 30, 3], ['bbbbb', 70, 7]]);
  });

  it('sufixo parecido não casa (segmento inteiro, nunca substring)', () => {
    const out = matchWorkerInstances(SVC, [s('4lx97', 'cpu_pct', 10)], [hb('4lx9')]);
    expect(out.map((r) => [r.instance, r.resource != null, r.heartbeat != null])).toEqual([
      ['4lx9', false, true], ['4lx97', true, false],
    ]);
  });

  it('batimento sem amostra vira linha só com batimento; o mais novo da instância vence', () => {
    const out = matchWorkerInstances(SVC, [], [hb('new01', { seenAt: ago(1), sessions: 1 }), hb('new01', { seenAt: ago(0.2), sessions: 2 })]);
    expect(out).toEqual([{ instance: 'new01', resource: null, cpuPct: null, memoryPct: null, sampledAt: null, heartbeat: expect.objectContaining({ sessions: 2 }) }]);
  });

  it('amostra sem batimento fica, e a instância trocada por deploy (> 2 min da mais nova) sai', () => {
    const out = matchWorkerInstances(SVC, [s('old01', 'cpu_pct', 90, ago(8)), s('cur01', 'memory_pct', 40, ago(1))], []);
    expect(out).toEqual([{ instance: 'cur01', resource: `${SVC}-cur01`, cpuPct: null, memoryPct: 40, sampledAt: ago(1), heartbeat: null }]);
  });

  it('batimento ainda vivo da instância trocada por deploy sai junto com a amostra (sem linha órfã)', () => {
    const out = matchWorkerInstances(
      SVC,
      [s('4lx97', 'cpu_pct', 90, ago(8)), s('cur01', 'cpu_pct', 20, ago(1))],
      [hb('4lx97', { seenAt: ago(1.2) }), hb('cur01'), hb('new02')],
    );
    expect(out.map((r) => [r.instance, r.resource != null, r.heartbeat != null])).toEqual([
      ['cur01', true, true], ['new02', false, true],
    ]);
  });

  it('valor mais novo por métrica vence', () => {
    const out = matchWorkerInstances(SVC, [s('a1b2c', 'cpu_pct', 5, ago(1.5)), s('a1b2c', 'cpu_pct', 9, ago(1))], []);
    expect(out[0].cpuPct).toBe(9);
  });
});
