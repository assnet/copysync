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
  };
}

describe('SessionStatusReconciler', () => {
  it('marca DISCONNECTED só sessões sem lease vivo', async () => {
    const r = repo([{ id: 's1', tenantId: 't1' }]);
    await new SessionStatusReconciler(r as unknown as ISessionRepository).markActiveSessionsAsDisconnected();
    expect(r.findActiveSessionsWithoutLiveLease).toHaveBeenCalledTimes(1);
    expect(r.findActiveSessionsForBootstrap).not.toHaveBeenCalled();
    expect(r.updateStatus).toHaveBeenCalledTimes(1);
    expect(r.updateStatus).toHaveBeenCalledWith('s1', 't1', expect.objectContaining({ status: 'DISCONNECTED' }));
  });

  it('sem sessões sem lease não grava nada', async () => {
    const r = repo([]);
    await new SessionStatusReconciler(r as unknown as ISessionRepository).markActiveSessionsAsDisconnected();
    expect(r.updateStatus).not.toHaveBeenCalled();
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
    expect(r.updateStatus).toHaveBeenCalledWith('leased', 't', expect.objectContaining({ status: 'DISCONNECTED' }));
  });

  it('espera TTL + folga do fence', () => {
    expect(LEASE_EXPIRY_RECHECK_DELAY_MS).toBe(65_000);
  });

  it('cancelar antes do prazo (shutdown) não roda a 2ª passada', async () => {
    vi.useFakeTimers();
    const pass = vi.fn().mockResolvedValue(0);
    const cancel = scheduleLeaseExpiryRecheck(pass);
    cancel();
    await vi.advanceTimersByTimeAsync(LEASE_EXPIRY_RECHECK_DELAY_MS * 2);
    expect(pass).not.toHaveBeenCalled();
  });

  it('1 instância sem lease órfão: 2ª passada não grava nada', async () => {
    vi.useFakeTimers();
    const r = repo([]);
    const reconciler = new SessionStatusReconciler(r as unknown as ISessionRepository);
    await reconciler.markActiveSessionsAsDisconnected();
    scheduleLeaseExpiryRecheck(() => reconciler.markActiveSessionsAsDisconnected());
    await vi.advanceTimersByTimeAsync(LEASE_EXPIRY_RECHECK_DELAY_MS);
    expect(r.findActiveSessionsWithoutLiveLease).toHaveBeenCalledTimes(2);
    expect(r.updateStatus).not.toHaveBeenCalled();
  });

  it('falha da 2ª passada não lança', async () => {
    vi.useFakeTimers();
    const pass = vi.fn().mockRejectedValue(new Error('db'));
    scheduleLeaseExpiryRecheck(pass, 10);
    await vi.advanceTimersByTimeAsync(10);
    expect(pass).toHaveBeenCalledTimes(1);
  });
});
