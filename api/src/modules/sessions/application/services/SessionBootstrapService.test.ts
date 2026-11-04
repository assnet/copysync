import { describe, expect, it, vi } from 'vitest';
import type { ISessionRepository } from '../../domain/contracts/ISessionRepository';
import type { IMessagingEngine } from '../../../messaging/domain/contracts/IMessagingEngine';
import { SessionLeaseHeldError } from '../../../../shared/errors/internal/SessionErrors';
import { SessionBootstrapService } from './SessionBootstrapService';

function setup(errors: Record<string, Error> = {}) {
  const sessions = [
    { id: 's1', tenantId: 't1' },
    { id: 's2', tenantId: 't2' },
  ];
  const repo = {
    findActiveSessionsForBootstrap: vi.fn().mockResolvedValue(sessions),
    updateStatus: vi.fn().mockResolvedValue(undefined),
  };
  const engine = {
    reconnectSession: vi.fn(async ({ sessionId }: { sessionId: string }) => {
      if (errors[sessionId]) throw errors[sessionId];
    }),
  };
  const svc = new SessionBootstrapService(
    repo as unknown as ISessionRepository,
    engine as unknown as IMessagingEngine,
    { maxConcurrent: 2 },
  );
  return { repo, engine, svc };
}

describe('SessionBootstrapService', () => {
  it('lease de outro worker: pula sem gravar status', async () => {
    const { repo, engine, svc } = setup({ s1: new SessionLeaseHeldError('s1') });
    await svc.bootstrap();
    expect(engine.reconnectSession).toHaveBeenCalledTimes(2);
    expect(repo.updateStatus).not.toHaveBeenCalled();
  });

  it('erro comum: grava DISCONNECTED só na sessão que falhou', async () => {
    const { repo, svc } = setup({ s2: new Error('boom') });
    await svc.bootstrap();
    expect(repo.updateStatus).toHaveBeenCalledTimes(1);
    expect(repo.updateStatus).toHaveBeenCalledWith('s2', 't2', { status: 'DISCONNECTED' });
  });

  it('lease em uma e erro em outra: só a com erro vira DISCONNECTED', async () => {
    const { repo, svc } = setup({ s1: new SessionLeaseHeldError('s1'), s2: new Error('boom') });
    await svc.bootstrap();
    expect(repo.updateStatus).toHaveBeenCalledTimes(1);
    expect(repo.updateStatus).toHaveBeenCalledWith('s2', 't2', { status: 'DISCONNECTED' });
  });

  it('sucesso: não grava status', async () => {
    const { repo, engine, svc } = setup();
    await svc.bootstrap();
    expect(engine.reconnectSession).toHaveBeenCalledTimes(2);
    expect(repo.updateStatus).not.toHaveBeenCalled();
  });
});
