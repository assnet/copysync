import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ISessionRepository } from '../../domain/contracts/ISessionRepository';
import {
  LEASE_EXPIRY_RECHECK_DELAY_MS,
  SessionStatusReconciler,
  scheduleLeaseExpiryRecheck,
} from './SessionStatusReconciler';

function repo(sessions: Array<{ id: string; tenantId: string }>) {
  return {
    findActiveSessionsForBootstrap: vi.fn().mockResolvedValue([{ id: 'leased', tenantId: 't' }, ...sessions]),
    findActiveSessionsWithoutLiveLease: vi.fn().mockResolvedValue(sessions),
    updateStatus: vi.fn().mockResolvedValue(undefined),
    markDisconnectedIfNoLiveLease: vi.fn().mockResolvedValue(true),
  };
}

describe('SessionStatusReconciler', () => {
  it('marca DISCONNECTED só sessões sem lease vivo', async () => {
    const r = repo([{ id: 's1', tenantId: 't1' }]);
    await new SessionStatusReconciler(r as unknown as ISessionRepository).markActiveSessionsAsDisconnected();
    expect(r.findActiveSessionsWithoutLiveLease).toHaveBeenCalledTimes(1);
    expect(r.findActiveSessionsForBootstrap).not.toHaveBeenCalled();
    expect(r.markDisconnectedIfNoLiveLease).toHaveBeenCalledTimes(1);
    expect(r.markDisconnectedIfNoLiveLease).toHaveBeenCalledWith('s1', 't1');
    expect(r.updateStatus).not.toHaveBeenCalled();
  });

  it('connect local entre o SELECT e o UPDATE (lease vivo): update condicional não grava e não conta', async () => {
    const r = repo([{ id: 's1', tenantId: 't1' }, { id: 's2', tenantId: 't1' }]);
    r.markDisconnectedIfNoLiveLease.mockResolvedValueOnce(false);
    await expect(
      new SessionStatusReconciler(r as unknown as ISessionRepository).markActiveSessionsAsDisconnected(),
    ).resolves.toBe(1);
    expect(r.markDisconnectedIfNoLiveLease).toHaveBeenCalledTimes(2);
    expect(r.updateStatus).not.toHaveBeenCalled();
  });

  it('sem sessões sem lease não grava nada', async () => {
    const r = repo([]);
    await new SessionStatusReconciler(r as unknown as ISessionRepository).markActiveSessionsAsDisconnected();
    expect(r.markDisconnectedIfNoLiveLease).not.toHaveBeenCalled();
  });

  it('falha na consulta não lança', async () => {
    const r = repo([]);
    r.findActiveSessionsWithoutLiveLease.mockRejectedValue(new Error('db'));
    await expect(
      new SessionStatusReconciler(r as unknown as ISessionRepository).markActiveSessionsAsDisconnected(),
    ).resolves.toBe(0);
    expect(r.updateStatus).not.toHaveBeenCalled();
  });
});

describe('scheduleLeaseExpiryRecheck (2ª passada do boot)', () => {
  afterEach(() => vi.useRealTimers());

  it('lease vivo de outro worker: pulada na 1ª passada e tratada após o TTL', async () => {
    vi.useFakeTimers();
    const r = repo([]);
    r.findActiveSessionsWithoutLiveLease
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'leased', tenantId: 't' }]);
    const reconciler = new SessionStatusReconciler(r as unknown as ISessionRepository);
    await expect(reconciler.markActiveSessionsAsDisconnected()).resolves.toBe(0);
    const pass = vi.fn(() => reconciler.markActiveSessionsAsDisconnected());
    scheduleLeaseExpiryRecheck(pass);

    await vi.advanceTimersByTimeAsync(LEASE_EXPIRY_RECHECK_DELAY_MS - 1);
    expect(pass).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(pass).toHaveBeenCalledTimes(1);
    await expect(pass.mock.results[0]!.value).resolves.toBe(1);
    expect(r.markDisconnectedIfNoLiveLease).toHaveBeenCalledWith('leased', 't');
  });

  it('espera TTL + folga do fence', () => {
    expect(LEASE_EXPIRY_RECHECK_DELAY_MS).toBe(65_000);
  });

  it('cancelar antes do prazo (shutdown) não roda a 2ª passada', async () => {
    vi.useFakeTimers();
    const pass = vi.fn().mockResolvedValue(0);
    const cancel = scheduleLeaseExpiryRecheck(pass);
    await expect(cancel()).resolves.toBeUndefined();
    await vi.advanceTimersByTimeAsync(LEASE_EXPIRY_RECHECK_DELAY_MS * 2);
    expect(pass).not.toHaveBeenCalled();
  });

  it('shutdown com a passada em curso: a promessa do cancel só resolve quando ela termina', async () => {
    vi.useFakeTimers();
    let finish!: (n: number) => void;
    const pass = vi.fn(() => new Promise<number>((res) => { finish = res; }));
    const cancel = scheduleLeaseExpiryRecheck(pass, 10);
    await vi.advanceTimersByTimeAsync(10);
    expect(pass).toHaveBeenCalledTimes(1);
    let settled = false;
    const done = cancel().then(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false);
    finish(1);
    await done;
    expect(settled).toBe(true);
  });

  it('passada em curso que falha: a promessa do cancel resolve sem lançar', async () => {
    vi.useFakeTimers();
    const pass = vi.fn().mockRejectedValue(new Error('db'));
    const cancel = scheduleLeaseExpiryRecheck(pass, 10);
    await vi.advanceTimersByTimeAsync(10);
    await expect(cancel()).resolves.toBeUndefined();
  });

  it('1 instância sem lease órfão: 2ª passada não grava nada', async () => {
    vi.useFakeTimers();
    const r = repo([]);
    const reconciler = new SessionStatusReconciler(r as unknown as ISessionRepository);
    await reconciler.markActiveSessionsAsDisconnected();
    scheduleLeaseExpiryRecheck(() => reconciler.markActiveSessionsAsDisconnected());
    await vi.advanceTimersByTimeAsync(LEASE_EXPIRY_RECHECK_DELAY_MS);
    expect(r.findActiveSessionsWithoutLiveLease).toHaveBeenCalledTimes(2);
    expect(r.markDisconnectedIfNoLiveLease).not.toHaveBeenCalled();
  });

  it('falha da 2ª passada não lança', async () => {
    vi.useFakeTimers();
    const pass = vi.fn().mockRejectedValue(new Error('db'));
    scheduleLeaseExpiryRecheck(pass, 10);
    await vi.advanceTimersByTimeAsync(10);
    expect(pass).toHaveBeenCalledTimes(1);
  });
});
