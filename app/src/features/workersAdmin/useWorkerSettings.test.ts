import { describe, expect, it } from 'vitest';
import type { WorkerOccupancyList } from './types';
import { busiestSessions } from './useWorkerSettings';

const totals = { workers: 0, sessions: 0, pendingLogins: 0, maxSessions: 0 };
const list = (over: Partial<WorkerOccupancyList>): WorkerOccupancyList => ({ workers: [], totals, awaiting: 0, ...over });
const worker = (sessions: number) => ({ workerId: `w${sessions}`, role: 'worker', sessions, pendingLogins: 0, maxSessions: 40, rssMb: 1, seenAt: '' });
const sampled = { connected: 22, sampledAt: '2026-11-11T10:00:00.000Z' };

describe('busiestSessions', () => {
  it('com batimentos: worker mais ocupado, mesmo com amostra de capacidade', () => {
    expect(busiestSessions(list({ workers: [worker(30), worker(12)] }), sampled)).toBe(30);
  });

  it('sem batimentos: connected da amostra de capacidade', () => {
    const off = list({ adoptionEnabled: false, processes: [{ workerId: 'p', sessions: 9, leaseUntil: '' }] });
    expect(busiestSessions(off, sampled)).toBe(22);
    expect(busiestSessions(list({}), sampled)).toBe(22);
    expect(busiestSessions(null, sampled)).toBe(22);
  });

  it('sem batimentos e sem amostra: processo mais ocupado; sem nada, null', () => {
    const off = list({ adoptionEnabled: false, processes: [{ workerId: 'p', sessions: 9, leaseUntil: '' }] });
    expect(busiestSessions(off, { connected: 0, sampledAt: null })).toBe(9);
    expect(busiestSessions(off)).toBe(9);
    expect(busiestSessions(list({}), null)).toBeNull();
    expect(busiestSessions(null)).toBeNull();
  });
});
