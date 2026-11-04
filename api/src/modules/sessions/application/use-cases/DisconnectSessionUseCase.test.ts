import { describe, expect, it, vi } from 'vitest';
import { DisconnectSessionUseCase } from './DisconnectSessionUseCase';
import { makeAuditRepo, makeSession, makeSessionRepo } from './sessionTestFakes';
import type { IMessagingEngine } from '../../../messaging/domain/contracts/IMessagingEngine';

function setup(status: 'CONNECTED' | 'DISCONNECTED' = 'CONNECTED') {
  const calls: string[] = [];
  const sessionRepo = makeSessionRepo(makeSession({ status }));
  sessionRepo.updateStatus.mockImplementation(async () => { calls.push('status'); });
  const engine = {
    disconnectSession: vi.fn(async () => { calls.push('engine'); }),
  } as unknown as IMessagingEngine & { disconnectSession: ReturnType<typeof vi.fn> };
  const leaseRelease = { execute: vi.fn(async () => { calls.push('release'); }) };
  const uc = new DisconnectSessionUseCase(sessionRepo, makeAuditRepo(), engine, leaseRelease);
  return { calls, sessionRepo, engine, leaseRelease, uc };
}

const input = { sessionId: 's1', tenantId: 't1', userId: 'u1' };

describe('DisconnectSessionUseCase', () => {
  it('grava DISCONNECTED e limpa o pedido antes da engine; solta o lease depois', async () => {
    const { calls, sessionRepo, leaseRelease, uc } = setup();

    await expect(uc.execute(input)).resolves.toEqual({ sessionId: 's1', status: 'DISCONNECTED' });

    expect(calls).toEqual(['status', 'engine', 'release']);
    expect(sessionRepo.updateStatus).toHaveBeenCalledWith('s1', 't1', expect.objectContaining({
      status: 'DISCONNECTED', clearConnectRequest: true,
    }));
    expect(leaseRelease.execute).toHaveBeenCalledWith('s1');
  });

  it('falha da engine não solta o lease (socket pode seguir aberto)', async () => {
    const { calls, engine, leaseRelease, uc } = setup();
    engine.disconnectSession.mockRejectedValueOnce(new Error('boom'));

    await expect(uc.execute(input)).rejects.toThrow('boom');

    expect(calls).toEqual(['status']);
    expect(leaseRelease.execute).not.toHaveBeenCalled();
  });

  it('estado inválido não grava nem chama engine', async () => {
    const { calls, uc } = setup('DISCONNECTED');

    await expect(uc.execute(input)).rejects.toThrow();
    expect(calls).toEqual([]);
  });

  it('sem leaseRelease funciona como antes', async () => {
    const sessionRepo = makeSessionRepo(makeSession({ status: 'CONNECTED' }));
    const engine = { disconnectSession: vi.fn(async () => undefined) } as unknown as IMessagingEngine;
    const uc = new DisconnectSessionUseCase(sessionRepo, makeAuditRepo(), engine);

    await expect(uc.execute(input)).resolves.toEqual({ sessionId: 's1', status: 'DISCONNECTED' });
  });
});
