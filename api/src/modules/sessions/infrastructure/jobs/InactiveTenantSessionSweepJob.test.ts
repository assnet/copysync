import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ISessionRepository } from '../../domain/contracts/ISessionRepository';
import { makeAuditRepo } from '../../application/use-cases/sessionTestFakes';
import { InactiveTenantSessionDisconnector } from '../../application/services/InactiveTenantSessionDisconnector';
import { InactiveTenantSessionSweepJob } from './InactiveTenantSessionSweepJob';

/** Tenant por sessão e status do tenant: simula o JOIN da consulta. */
const TENANT_OF: Record<string, string> = { a1: 'active', s1: 'suspended', s2: 'suspended', c1: 'cancelled' };
const STATUS: Record<string, string> = { active: 'ACTIVE', suspended: 'SUSPENDED', cancelled: 'CANCELLED' };

function setup(local: string[]) {
  const repo = {
    findWithInactiveTenant: vi.fn(async (ids: readonly string[]) =>
      ids.filter((id) => STATUS[TENANT_OF[id]!] !== 'ACTIVE').map((id) => ({ id, tenantId: TENANT_OF[id]! }))),
    markDisconnectedUnlessLeasedElsewhere: vi.fn(async () => true),
    updateStatus: vi.fn(async () => null),
  };
  const engine = { disconnectSession: vi.fn(async () => undefined) };
  const release = { execute: vi.fn(async () => undefined) };
  const audit = makeAuditRepo();
  const disconnector = new InactiveTenantSessionDisconnector({
    sessions: repo as unknown as ISessionRepository,
    engine,
    audit,
    leaseRelease: release,
    ownerWorkerId: 'wA',
  });
  const listLocal = vi.fn(() => local);
  const job = new InactiveTenantSessionSweepJob({
    sessions: repo as unknown as ISessionRepository,
    disconnector,
    listLocal,
  });
  return { job, repo, engine, release, audit, disconnector, listLocal };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('InactiveTenantSessionSweepJob', () => {
  it('consulta só as sessões locais e desconecta as de tenant não ACTIVE', async () => {
    const { job, repo, engine, audit } = setup(['a1', 's1', 'c1']);
    await job.runTick();
    expect(repo.findWithInactiveTenant).toHaveBeenCalledWith(['a1', 's1', 'c1']);
    expect(engine.disconnectSession.mock.calls.map((c) => (c as unknown as [{ sessionId: string }])[0].sessionId))
      .toEqual(['s1', 'c1']);
    expect(repo.markDisconnectedUnlessLeasedElsewhere).toHaveBeenCalledWith('s1', 'suspended', 'wA');
    expect(audit.create).toHaveBeenCalledWith(expect.objectContaining({
      meta: expect.objectContaining({ sessionId: 'c1', reason: 'TENANT_NOT_ACTIVE' }),
    }));
  });

  it('sem sessões locais não consulta o banco', async () => {
    const { job, repo } = setup([]);
    await job.runTick();
    expect(repo.findWithInactiveTenant).not.toHaveBeenCalled();
  });

  it('falha na consulta só loga', async () => {
    const { job, repo, engine } = setup(['s1']);
    repo.findWithInactiveTenant.mockRejectedValueOnce(new Error('db'));
    await expect(job.runTick()).resolves.toBeUndefined();
    expect(engine.disconnectSession).not.toHaveBeenCalled();
  });

  it('falha numa sessão não impede as outras', async () => {
    const { job, engine } = setup(['s1', 's2']);
    engine.disconnectSession.mockRejectedValueOnce(new Error('boom'));
    await job.runTick();
    expect(engine.disconnectSession).toHaveBeenCalledTimes(2);
  });

  it('não duplica com o listener: sessão em andamento no disconnector é ignorada', async () => {
    const { job, engine, disconnector, audit } = setup(['s1']);
    let finish!: () => void;
    engine.disconnectSession.mockImplementationOnce(() => new Promise<undefined>((r) => { finish = () => r(undefined); }));
    const fromListener = disconnector.disconnect('s1', 'suspended', 'TENANT_SUSPENDED');
    await vi.waitFor(() => expect(engine.disconnectSession).toHaveBeenCalledTimes(1));
    await job.runTick();
    expect(engine.disconnectSession).toHaveBeenCalledTimes(1);
    finish();
    await expect(fromListener).resolves.toBe(true);
    expect(audit.create).toHaveBeenCalledTimes(1);
  });

  it('start agenda a cada 30 s com timer unref; stop para e espera a passada', async () => {
    vi.useFakeTimers();
    const { job, listLocal } = setup(['a1']);
    job.start();
    job.start();
    expect(listLocal).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(listLocal).toHaveBeenCalledTimes(1);
    await job.stop();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(listLocal).toHaveBeenCalledTimes(1);
  });
});
