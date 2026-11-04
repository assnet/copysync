import { afterEach, describe, expect, it, vi } from 'vitest';
import { internalEventBus } from '../../../../shared/events/InternalEventBus';
import type { ISessionRepository } from '../../domain/contracts/ISessionRepository';
import type { IMessagingEngine } from '../../../messaging/domain/contracts/IMessagingEngine';
import { makeAuditRepo, makeSession } from '../../application/use-cases/sessionTestFakes';
import { registerTenantSuspendedSessionListener } from './TenantSuspendedSessionListener';

function setup(sessions = [makeSession({ id: 's1', status: 'CONNECTED' })]) {
  const calls: string[] = [];
  const repo = {
    findAllByTenant: vi.fn(async () => sessions),
    updateStatus: vi.fn(async (id: string) => {
      calls.push(`status:${id}`);
      return null;
    }),
  };
  const engine = {
    disconnectSession: vi.fn(async ({ sessionId }: { sessionId: string }) => {
      calls.push(`engine:${sessionId}`);
    }),
  };
  const release = {
    execute: vi.fn(async (id: string) => {
      calls.push(`release:${id}`);
    }),
  };
  const audit = makeAuditRepo();
  registerTenantSuspendedSessionListener(
    repo as unknown as ISessionRepository,
    engine as unknown as IMessagingEngine,
    audit,
    release,
  );
  return { calls, repo, engine, release, audit };
}

function suspend() {
  internalEventBus.emit('TENANT_SUSPENDED', { type: 'TENANT_SUSPENDED', tenantId: 't1' });
}

afterEach(() => {
  internalEventBus.removeAllListeners('TENANT_SUSPENDED');
});

describe('registerTenantSuspendedSessionListener', () => {
  it('grava status com limpeza do pedido, depois engine, depois solta o lease', async () => {
    const { calls, repo, audit } = setup();
    suspend();
    await vi.waitFor(() => expect(audit.create).toHaveBeenCalledTimes(1));
    expect(calls).toEqual(['status:s1', 'engine:s1', 'release:s1']);
    expect(repo.updateStatus).toHaveBeenCalledWith('s1', 't1', expect.objectContaining({
      status: 'DISCONNECTED',
      clearConnectRequest: true,
    }));
  });

  it('falha numa sessão não impede as outras', async () => {
    const { engine, release, calls } = setup([
      makeSession({ id: 's1', status: 'CONNECTED' }),
      makeSession({ id: 's2', status: 'CONNECTING' }),
    ]);
    engine.disconnectSession.mockRejectedValueOnce(new Error('boom'));
    suspend();
    await vi.waitFor(() => expect(release.execute).toHaveBeenCalledWith('s2'));
    expect(calls).toEqual(['status:s1', 'release:s1', 'status:s2', 'engine:s2', 'release:s2']);
  });

  it('falha ao gravar status não chama engine e segue para a próxima', async () => {
    const { repo, engine, release } = setup([
      makeSession({ id: 's1', status: 'CONNECTED' }),
      makeSession({ id: 's2', status: 'CONNECTED' }),
    ]);
    repo.updateStatus.mockRejectedValueOnce(new Error('db'));
    suspend();
    await vi.waitFor(() => expect(release.execute).toHaveBeenCalledWith('s2'));
    expect(engine.disconnectSession).toHaveBeenCalledTimes(1);
    expect(engine.disconnectSession).toHaveBeenCalledWith({ sessionId: 's2', tenantId: 't1' });
    expect(release.execute).not.toHaveBeenCalledWith('s1');
  });

  it('mantém o filtro canDisconnect', async () => {
    const { repo, engine, release, audit } = setup([
      makeSession({ id: 's1', status: 'DISCONNECTED' }),
      makeSession({ id: 's2', status: 'CONNECTED' }),
    ]);
    suspend();
    await vi.waitFor(() => expect(audit.create).toHaveBeenCalledTimes(1));
    expect(repo.updateStatus).toHaveBeenCalledTimes(1);
    expect(engine.disconnectSession).toHaveBeenCalledTimes(1);
    expect(release.execute).toHaveBeenCalledTimes(1);
    expect(release.execute).toHaveBeenCalledWith('s2');
  });

  it('funciona sem leaseRelease', async () => {
    const engine = { disconnectSession: vi.fn(async () => undefined) };
    const audit = makeAuditRepo();
    registerTenantSuspendedSessionListener(
      {
        findAllByTenant: vi.fn(async () => [makeSession({ status: 'CONNECTED' })]),
        updateStatus: vi.fn(async () => null),
      } as unknown as ISessionRepository,
      engine as unknown as IMessagingEngine,
      audit,
    );
    suspend();
    await vi.waitFor(() => expect(audit.create).toHaveBeenCalledTimes(1));
    expect(engine.disconnectSession).toHaveBeenCalledTimes(1);
  });
});
