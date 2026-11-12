import { afterEach, describe, expect, it, vi } from 'vitest';
import { internalEventBus } from '../../../../shared/events/InternalEventBus';
import type { ISessionRepository } from '../../domain/contracts/ISessionRepository';
import { makeAuditRepo, makeSession } from '../../application/use-cases/sessionTestFakes';
import { InactiveTenantSessionDisconnector } from '../../application/services/InactiveTenantSessionDisconnector';
import { registerTenantSuspendedSessionListener } from './TenantSuspendedSessionListener';

/** Dono do lease por sessão (lease vivo); ausente = sem dono vivo. Simula o filtro do UPDATE. */
type Owners = Record<string, string>;

function setup(sessions = [makeSession({ id: 's1', status: 'CONNECTED' })], opts: { ownerWorkerId?: string; owners?: Owners } = {}) {
  const calls: string[] = [];
  const owners = opts.owners ?? {};
  const repo = {
    findAllByTenant: vi.fn(async () => sessions),
    updateStatus: vi.fn(async (id: string) => {
      calls.push(`status:${id}`);
      return null;
    }),
    markDisconnectedUnlessLeasedElsewhere: vi.fn(async (id: string, _t: string, workerId: string) => {
      const owner = owners[id];
      if (owner && owner !== workerId) return false;
      calls.push(`status:${id}`);
      return true;
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
  const disconnector = new InactiveTenantSessionDisconnector({
    sessions: repo as unknown as ISessionRepository,
    engine,
    audit,
    leaseRelease: release,
    ...(opts.ownerWorkerId && { ownerWorkerId: opts.ownerWorkerId }),
  });
  registerTenantSuspendedSessionListener(repo as unknown as ISessionRepository, disconnector);
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
    expect(audit.create).toHaveBeenCalledWith(expect.objectContaining({
      meta: expect.objectContaining({ sessionId: 's1', reason: 'TENANT_SUSPENDED' }),
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

  it('no http (sem dono) usa o caminho de antes: todas as sessões, sem filtro de dono', async () => {
    const { repo, engine, audit } = setup(
      [makeSession({ id: 'a', status: 'CONNECTED' }), makeSession({ id: 'b', status: 'CONNECTED' })],
      { owners: { a: 'wA', b: 'wB' } },
    );
    suspend();
    await vi.waitFor(() => expect(audit.create).toHaveBeenCalledTimes(2));
    expect(repo.markDisconnectedUnlessLeasedElsewhere).not.toHaveBeenCalled();
    expect(engine.disconnectSession).toHaveBeenCalledTimes(2);
  });

  it('OWN-04: no processo A só sessões de A e sem dono vivo; a de B fica intacta', async () => {
    const { repo, engine, release, audit, calls } = setup(
      [
        makeSession({ id: 'a', status: 'CONNECTED' }),
        makeSession({ id: 'b', status: 'CONNECTED' }),
        makeSession({ id: 'free', status: 'AWAITING_QR' }),
      ],
      { ownerWorkerId: 'wA', owners: { a: 'wA', b: 'wB' } },
    );
    suspend();
    await vi.waitFor(() => expect(audit.create).toHaveBeenCalledTimes(2));
    expect(repo.updateStatus).not.toHaveBeenCalled();
    expect(repo.markDisconnectedUnlessLeasedElsewhere).toHaveBeenCalledWith('b', 't1', 'wA');
    expect(calls).toEqual(['status:a', 'engine:a', 'release:a', 'status:free', 'engine:free', 'release:free']);
    expect(engine.disconnectSession).not.toHaveBeenCalledWith(expect.objectContaining({ sessionId: 'b' }));
    expect(release.execute).not.toHaveBeenCalledWith('b');
  });
});
