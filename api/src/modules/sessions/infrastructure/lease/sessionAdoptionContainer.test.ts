import { afterEach, describe, expect, it, vi } from 'vitest';

const cfg = vi.hoisted(() => ({ enabled: false, shard: null as string | null }));
const teto = vi.hoisted(() => ({ maxSessionsPerWorker: 3 }));
const spies = vi.hoisted(() => ({ adoptionRepo: 0, register: 0, lease: 0 }));

vi.mock('../../../../shared/database/prisma.client', () => ({ prisma: {} }));
vi.mock('../../../../shared/config/workerAdoption', () => ({ workerAdoptionConfig: () => cfg }));
vi.mock('../../../../shared/config/processRole', () => ({ currentRole: () => 'worker' }));
vi.mock('../../../../shared/audit/PrismaAuditLogRepository', () => ({ PrismaAuditLogRepository: class { create = vi.fn(); } }));
vi.mock('../../../../shared/infrastructure/jobs/PrismaJobLease', () => ({
  PrismaJobLease: class { tryAcquire = vi.fn().mockResolvedValue(false); release = vi.fn(); },
}));
vi.mock('../../../../shared/engine/activeEngine', () => ({
  getActiveEngine: () => ({ adoptSession: vi.fn(), abortSession: vi.fn() }),
}));
vi.mock('../repositories/PrismaSessionAdoptionRepository', () => ({
  PrismaSessionAdoptionRepository: class {
    constructor() { spies.adoptionRepo++; }
    adoptNext = vi.fn(); failExhausted = vi.fn().mockResolvedValue([]); resetFailures = vi.fn(); countAwaitingCapacity = vi.fn();
  },
}));
vi.mock('../repositories/PrismaWorkerHeartbeatRepository', () => ({
  PrismaWorkerHeartbeatRepository: class { beat = vi.fn(); listAlive = vi.fn(); remove = vi.fn(); },
}));
vi.mock('../listeners/SessionAdoptionResetListener', () => ({
  registerSessionAdoptionResetListener: () => { spies.register++; return () => undefined; },
}));
vi.mock('./sessionLeaseContainer', () => ({
  sessionLeaseContainer: () => { spies.lease++; return { workerId: 'w-test', occupancy: () => ({ sessions: 0, pendingLogins: 0 }) }; },
  workerScalingSettingsProvider: () => ({ current: () => ({ value: { maxSessionsPerWorker: teto.maxSessionsPerWorker } }) }),
}));

async function load() {
  vi.resetModules();
  return import('./sessionAdoptionContainer');
}

afterEach(() => {
  vi.useRealTimers();
  cfg.enabled = false;
  spies.adoptionRepo = 0; spies.register = 0; spies.lease = 0;
});

describe('sessionAdoptionContainer', () => {
  it('flag off: null, nada montado e nenhum timer criado', async () => {
    vi.useFakeTimers();
    const { sessionAdoptionContainer } = await load();
    expect(sessionAdoptionContainer()).toBeNull();
    expect(sessionAdoptionContainer()).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
    expect(spies).toEqual({ adoptionRepo: 0, register: 0, lease: 0 });
  });

  it('flag on: monta uma vez, registra o reset e nasce parado', async () => {
    vi.useFakeTimers();
    cfg.enabled = true;
    const { sessionAdoptionContainer } = await load();
    const a = sessionAdoptionContainer();
    expect(a).not.toBeNull();
    expect(sessionAdoptionContainer()).toBe(a);
    expect(spies).toEqual({ adoptionRepo: 1, register: 1, lease: 1 });
    expect(vi.getTimerCount()).toBe(0);
    await a!.heartbeat.runTick();
    expect(a!.heartbeats.beat).toHaveBeenLastCalledWith(expect.objectContaining({ maxSessions: 3 }));
    teto.maxSessionsPerWorker = 9;
    await a!.heartbeat.runTick();
    expect(a!.heartbeats.beat).toHaveBeenLastCalledWith(expect.objectContaining({ maxSessions: 9 }));
    teto.maxSessionsPerWorker = 3;

    a!.ticker.start();
    a!.heartbeat.start();
    a!.capacityAlert.start();
    expect(vi.getTimerCount()).toBe(3);
    await a!.ticker.stop();
    await a!.heartbeat.stop();
    await a!.capacityAlert.stop();
    expect(vi.getTimerCount()).toBe(0);
    expect(a!.heartbeats.remove).toHaveBeenCalledWith('w-test');
  });

  it('build: dispose remove o listener de reset', async () => {
    const { buildSessionAdoptionContainer } = await load();
    const unregister = vi.fn();
    const registerReset = vi.fn().mockReturnValue(unregister);
    const adoption = { adoptNext: vi.fn(), failExhausted: vi.fn(), resetFailures: vi.fn(), countAwaitingCapacity: vi.fn() };
    const c = buildSessionAdoptionContainer({
      config: { enabled: true, shard: 'a' },
      lease: { workerId: 'w1', occupancy: () => ({ sessions: 0, pendingLogins: 0 }) },
      settings: { current: () => ({ value: { maxSessionsPerWorker: 2 } }) } as never,
      role: 'all',
      adoption: adoption as never,
      heartbeats: { beat: vi.fn(), listAlive: vi.fn(), remove: vi.fn() } as never,
      jobLease: { tryAcquire: vi.fn(), release: vi.fn() } as never,
      audit: { create: vi.fn() } as never,
      engine: { adoptSession: vi.fn(), abortSession: vi.fn() },
      registerReset,
    });
    expect(registerReset).toHaveBeenCalledWith(adoption);
    c.dispose();
    expect(unregister).toHaveBeenCalledTimes(1);
  });

  it('build: a adoção lê o teto do provider a cada tick (WSCALE-04)', async () => {
    vi.useFakeTimers();
    const { buildSessionAdoptionContainer } = await load();
    const { ADOPT_TICK_MS } = await import('../../domain/services/sessionAdoptionPolicy');
    let max = 2;
    const adoption = {
      adoptNext: vi.fn(async () => null), failExhausted: vi.fn(async () => []), resetFailures: vi.fn(),
      revertAdoptAttempt: vi.fn(), countAwaitingCapacity: vi.fn(),
    };
    const c = buildSessionAdoptionContainer({
      config: { enabled: true, shard: null },
      lease: { workerId: 'w1', occupancy: () => ({ sessions: 2, pendingLogins: 0 }) },
      settings: { current: () => ({ value: { maxSessionsPerWorker: max } }) } as never,
      role: 'worker',
      adoption: adoption as never,
      heartbeats: { beat: vi.fn(), listAlive: vi.fn(), remove: vi.fn() } as never,
      jobLease: { tryAcquire: vi.fn(), release: vi.fn() } as never,
      audit: { create: vi.fn() } as never,
      engine: { adoptSession: vi.fn(), abortSession: vi.fn() },
      registerReset: () => () => undefined,
    });
    c.ticker.start();
    await vi.advanceTimersByTimeAsync(ADOPT_TICK_MS);
    expect(adoption.adoptNext).not.toHaveBeenCalled();
    max = 3;
    await vi.advanceTimersByTimeAsync(ADOPT_TICK_MS);
    expect(adoption.adoptNext).toHaveBeenCalledTimes(1);
    await c.ticker.stop();
  });
});
