import { describe, it, expect, vi } from 'vitest';
import { ListWorkersUseCase } from './ListWorkersUseCase';
import { WORKER_ALIVE_MS } from '../../domain/services/sessionAdoptionPolicy';
import type { WorkerHeartbeat } from '../../domain/contracts/IWorkerHeartbeatRepository';

const seenAt = new Date('2026-11-04T12:00:00.000Z');
const row = (workerId: string, sessions: number, maxSessions: number, pendingLogins = 0): WorkerHeartbeat =>
  ({ workerId, role: 'worker', sessions, pendingLogins, maxSessions, rssMb: 300, seenAt });

function build(rows: WorkerHeartbeat[], awaiting: number) {
  const heartbeats = { beat: vi.fn(), remove: vi.fn(), hasAlive: vi.fn(), listAlive: vi.fn().mockResolvedValue(rows) };
  const adoption = { countAwaitingCapacity: vi.fn().mockResolvedValue(awaiting) };
  return { uc: new ListWorkersUseCase(heartbeats, adoption), heartbeats, adoption };
}

describe('ListWorkersUseCase', () => {
  it('soma sessões e tetos dos vivos e devolve os aguardando', async () => {
    const { uc, heartbeats, adoption } = build([row('w1', 3, 40, 2), row('w2', 40, 40, 1)], 5);
    const out = await uc.execute();
    expect(heartbeats.listAlive).toHaveBeenCalledWith(WORKER_ALIVE_MS);
    expect(adoption.countAwaitingCapacity).toHaveBeenCalledWith();
    expect(out.totals).toEqual({ workers: 2, sessions: 43, pendingLogins: 3, maxSessions: 80 });
    expect(out.awaiting).toBe(5);
    expect(out.workers.map((w) => w.workerId)).toEqual(['w1', 'w2']);
  });

  it('sem workers vivos: lista vazia e totais zerados', async () => {
    const out = await build([], 2).uc.execute();
    expect(out).toEqual({ workers: [], totals: { workers: 0, sessions: 0, pendingLogins: 0, maxSessions: 0 }, awaiting: 2 });
  });
});
