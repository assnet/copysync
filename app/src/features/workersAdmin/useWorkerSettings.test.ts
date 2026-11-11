import { describe, expect, it } from 'vitest';
import type { WorkerOccupancyList } from './types';
import { busiestSessions } from './useWorkerSettings';

const totals = { workers: 0, sessions: 0, pendingLogins: 0, maxSessions: 0 };
const list = (over: Partial<WorkerOccupancyList>): WorkerOccupancyList => ({ workers: [], totals, awaiting: 0, ...over });
const worker = (sessions: number) => ({ workerId: `w${sessions}`, role: 'worker', sessions, pendingLogins: 0, maxSessions: 40, rssMb: 1, seenAt: '' });

describe('busiestSessions', () => {
  it('com batimentos: worker mais ocupado, mesmo com a adoção desligada neste processo', () => {
    expect(busiestSessions(list({ workers: [worker(30), worker(12)] }))).toBe(30);
    expect(busiestSessions(list({ adoptionEnabled: false, workers: [worker(7)] }))).toBe(7);
  });

  it('sem batimentos: null, mesmo com processos (sem aviso)', () => {
    const off = list({ adoptionEnabled: false, processes: [{ workerId: 'p', sessions: 9, leaseUntil: '' }] });
    expect(busiestSessions(off)).toBeNull();
    expect(busiestSessions(list({}))).toBeNull();
    expect(busiestSessions(null)).toBeNull();
  });
});
