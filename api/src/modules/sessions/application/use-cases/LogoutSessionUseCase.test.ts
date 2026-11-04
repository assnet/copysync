import { describe, expect, it, vi } from 'vitest';
import { LogoutSessionUseCase } from './LogoutSessionUseCase';
import { makeAuditRepo, makeSession, makeSessionRepo } from './sessionTestFakes';
import type { ISessionAuthStateRepository } from '../../domain/contracts/ISessionAuthStateRepository';
import type { IMessagingEngine } from '../../../messaging/domain/contracts/IMessagingEngine';

function setup() {
  const calls: string[] = [];
  const sessionRepo = makeSessionRepo(makeSession({ status: 'CONNECTED' }));
  sessionRepo.updateStatus.mockImplementation(async () => { calls.push('status'); });
  const authState = {
    clearCredentials: vi.fn(async () => { calls.push('credentials'); }),
  } as unknown as ISessionAuthStateRepository;
  const engine = {
    logoutSession: vi.fn(async () => { calls.push('engine'); }),
  } as unknown as IMessagingEngine & { logoutSession: ReturnType<typeof vi.fn> };
  const leaseRelease = { execute: vi.fn(async () => { calls.push('release'); }) };
  const uc = new LogoutSessionUseCase(sessionRepo, authState, makeAuditRepo(), engine, leaseRelease);
  return { calls, sessionRepo, engine, leaseRelease, uc };
}

const input = { sessionId: 's1', tenantId: 't1', userId: 'u1' };

describe('LogoutSessionUseCase', () => {
  it('grava LOGGED_OUT e limpa o pedido antes da engine; solta o lease depois', async () => {
    const { calls, sessionRepo, leaseRelease, uc } = setup();

    await expect(uc.execute(input)).resolves.toEqual({ sessionId: 's1', status: 'LOGGED_OUT' });

    expect(calls).toEqual(['status', 'engine', 'release', 'credentials']);
    expect(sessionRepo.updateStatus).toHaveBeenCalledWith('s1', 't1', expect.objectContaining({
      status: 'LOGGED_OUT', clearConnectRequest: true,
    }));
    expect(leaseRelease.execute).toHaveBeenCalledWith('s1');
  });

  it('falha da engine não solta o lease', async () => {
    const { calls, engine, leaseRelease, uc } = setup();
    engine.logoutSession.mockRejectedValueOnce(new Error('boom'));

    await expect(uc.execute(input)).rejects.toThrow('boom');

    expect(calls).toEqual(['status']);
    expect(leaseRelease.execute).not.toHaveBeenCalled();
  });

  it('sessão inexistente não grava', async () => {
    const sessionRepo = makeSessionRepo(null);
    const uc = new LogoutSessionUseCase(
      sessionRepo, {} as ISessionAuthStateRepository, makeAuditRepo(), {} as IMessagingEngine,
    );

    await expect(uc.execute(input)).rejects.toThrow();
    expect(sessionRepo.updateStatus).not.toHaveBeenCalled();
  });
});
