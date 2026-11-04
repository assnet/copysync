import { describe, expect, it, vi } from 'vitest';
import type { ISessionRepository } from '../../domain/contracts/ISessionRepository';
import { SessionStatusReconciler } from './SessionStatusReconciler';

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
    ).resolves.toBeUndefined();
    expect(r.updateStatus).not.toHaveBeenCalled();
  });
});
