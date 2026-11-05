import { describe, expect, it, vi } from 'vitest';
import type { IJobLease } from '../../../../shared/jobs/IJobLease';
import type { IWorkerHeartbeatRepository, WorkerHeartbeat } from '../../domain/contracts/IWorkerHeartbeatRepository';
import type { ISessionAdoptionRepository } from '../../domain/contracts/ISessionAdoptionRepository';
import {
  CAPACITY_ALERT_EMAIL_LEASE,
  CAPACITY_ALERT_LEASE,
  WorkerCapacityAlertJob,
  type CapacityAlert,
} from './WorkerCapacityAlertJob';

/** Lease com relógio: livre se ausente ou vencido (`expiresAt < now`), como o Prisma. */
class ClockLease implements IJobLease {
  held = new Map<string, { owner: string; until: Date }>();
  acquires: string[] = [];
  async tryAcquire(name: string, owner: string, until: Date, now: Date): Promise<boolean> {
    const cur = this.held.get(name);
    if (cur && !(cur.until < now)) return false;
    this.held.set(name, { owner, until });
    this.acquires.push(name);
    return true;
  }
  async release(name: string, owner: string): Promise<void> {
    if (this.held.get(name)?.owner === owner) this.held.delete(name);
  }
}

const worker = (sessions: number, maxSessions: number): WorkerHeartbeat => ({
  workerId: `w${sessions}-${maxSessions}`, role: 'worker', sessions, pendingLogins: 0, maxSessions, rssMb: 300, seenAt: new Date(0),
});

function setup(workers: WorkerHeartbeat[], awaiting = 0, withNotifier = true) {
  let clock = new Date('2026-11-04T12:00:00Z');
  const lease = new ClockLease();
  const heartbeats: IWorkerHeartbeatRepository = {
    beat: vi.fn(), remove: vi.fn(), listAlive: vi.fn(async () => workers),
  };
  const adoption = {
    adoptNext: vi.fn(), failExhausted: vi.fn(), resetFailures: vi.fn(),
    countAwaitingCapacity: vi.fn(async () => awaiting),
  } as unknown as ISessionAdoptionRepository;
  const sent: CapacityAlert[] = [];
  const notifier = withNotifier ? { notify: vi.fn(async (a: CapacityAlert) => void sent.push(a)) } : undefined;
  const job = new WorkerCapacityAlertJob({ lease, heartbeats, adoption, notifier, now: () => clock });
  const advance = (ms: number) => { clock = new Date(clock.getTime() + ms); };
  return { job, lease, heartbeats, adoption, sent, advance };
}

describe('WorkerCapacityAlertJob', () => {
  it('81 % alerta por ocupação com somas dos vivos', async () => {
    const { job, sent, adoption } = setup([worker(40, 50), worker(41, 50)]);
    await job.runTick();
    expect(adoption.countAwaitingCapacity).toHaveBeenCalledWith(120_000);
    expect(sent).toEqual([{ reason: 'occupancy', workers: 2, sessions: 81, maxSessions: 100, awaiting: 0 }]);
  });

  it('80 % exato não alerta e só escreve o lease', async () => {
    const { job, sent, lease } = setup([worker(40, 50), worker(40, 50)]);
    await job.runTick();
    expect(sent).toEqual([]);
    expect(lease.acquires).toEqual([CAPACITY_ALERT_LEASE]);
  });

  it('pedido aguardando há > 2 min alerta mesmo sem worker vivo', async () => {
    const { job, sent } = setup([], 3);
    await job.runTick();
    expect(sent).toEqual([{ reason: 'awaiting', workers: 0, sessions: 0, maxSessions: 0, awaiting: 3 }]);
  });

  it('lease negado não consulta nada', async () => {
    const { job, lease, heartbeats, adoption, sent } = setup([worker(50, 50)]);
    lease.held.set(CAPACITY_ALERT_LEASE, { owner: 'outro', until: new Date('2030-01-01Z') });
    await job.runTick();
    expect(heartbeats.listAlive).not.toHaveBeenCalled();
    expect(adoption.countAwaitingCapacity).not.toHaveBeenCalled();
    expect(sent).toEqual([]);
  });

  it('2 ticks dentro do cooldown = 1 e-mail; depois de 30 min, outro', async () => {
    const { job, sent, lease, advance } = setup([worker(45, 50)]);
    await job.runTick();
    advance(60_000);
    await job.runTick();
    expect(lease.acquires.filter((n) => n === CAPACITY_ALERT_LEASE)).toHaveLength(2);
    expect(sent).toHaveLength(1);
    advance(30 * 60_000);
    await job.runTick();
    expect(sent).toHaveLength(2);
    expect(lease.held.has(CAPACITY_ALERT_EMAIL_LEASE)).toBe(true);
  });

  it('sem notifier (D5 adiado) só loga e não pega o lease do e-mail', async () => {
    const { job, lease } = setup([worker(45, 50)], 0, false);
    await job.runTick();
    expect(lease.acquires).toEqual([CAPACITY_ALERT_LEASE]);
  });

  it('falha de consulta não lança', async () => {
    const { job, heartbeats } = setup([]);
    vi.mocked(heartbeats.listAlive).mockRejectedValueOnce(new Error('db'));
    await expect(job.runTick()).resolves.toBeUndefined();
  });
});
