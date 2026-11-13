import { describe, expect, it, vi } from 'vitest';
import { DeleteSessionUseCase } from './DeleteSessionUseCase';
import { makeAuditRepo, makeSession, makeSessionRepo } from './sessionTestFakes';
import type { ISessionAuthStateRepository } from '../../domain/contracts/ISessionAuthStateRepository';
import type { IMessagingEngine } from '../../../messaging/domain/contracts/IMessagingEngine';
import { logger } from '../../../../shared/logger/logger';

describe('DeleteSessionUseCase', () => {
  it('pausa recursos ligados à sessão antes do soft delete', async () => {
    const calls: string[] = [];
    const sessionRepo = makeSessionRepo(makeSession({ status: 'DISCONNECTED' }));
    (sessionRepo as unknown as { softDelete: unknown }).softDelete = vi.fn(async () => { calls.push('softDelete'); });
    const authState = { deleteBySessionId: vi.fn(async () => undefined) } as unknown as ISessionAuthStateRepository;
    const linked = { pauseBySession: vi.fn(async () => { calls.push('pause'); return 1; }) };
    const uc = new DeleteSessionUseCase(sessionRepo, authState, makeAuditRepo(), {} as IMessagingEngine, [linked]);

    await uc.execute({ sessionId: 's1', tenantId: 't1', userId: 'u1' });

    expect(linked.pauseBySession).toHaveBeenCalledWith('t1', 's1');
    expect(calls).toEqual(['pause', 'softDelete']);
  });

  function withAfterDelete(close: () => Promise<unknown>) {
    const calls: string[] = [];
    const sessionRepo = makeSessionRepo(makeSession({ status: 'DISCONNECTED' }));
    (sessionRepo as unknown as { softDelete: unknown }).softDelete = vi.fn(async () => { calls.push('softDelete'); });
    const authState = { deleteBySessionId: vi.fn(async () => { calls.push('authState'); }) } as unknown as ISessionAuthStateRepository;
    const linked = { pauseBySession: vi.fn(async () => { calls.push('pause'); return 1; }) };
    const dispatches = { pauseBySession: vi.fn(async () => { calls.push('closeDispatches'); return close(); }) };
    const audit = makeAuditRepo();
    const uc = new DeleteSessionUseCase(sessionRepo, authState, audit, {} as IMessagingEngine, [linked], undefined, [dispatches]);
    return { calls, dispatches, audit, uc };
  }

  it('envios da fila fecham DEPOIS do soft delete (o claim já ignora a sessão); rodízio segue antes', async () => {
    const { calls, dispatches, uc } = withAfterDelete(async () => 3);

    await uc.execute({ sessionId: 's1', tenantId: 't1', userId: 'u1' });

    expect(dispatches.pauseBySession).toHaveBeenCalledWith('t1', 's1');
    expect(calls).toEqual(['authState', 'pause', 'softDelete', 'closeDispatches']);
  });

  it('falha ao fechar os envios não desfaz a exclusão nem a auditoria (o lote do worker fecha depois)', async () => {
    const { calls, audit, uc } = withAfterDelete(async () => { throw new Error('db down'); });
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);

    await expect(uc.execute({ sessionId: 's1', tenantId: 't1', userId: 'u1' })).resolves.toBeUndefined();

    expect(calls).toEqual(['authState', 'pause', 'softDelete', 'closeDispatches']);
    expect(audit.create).toHaveBeenCalledWith(expect.objectContaining({ action: 'SESSION_DELETED' }));
    expect(warn).toHaveBeenCalledTimes(1);
  });

  function setup(status: 'CONNECTED' | 'LOGGED_OUT') {
    const calls: string[] = [];
    const sessionRepo = makeSessionRepo(makeSession({ status }));
    sessionRepo.updateStatus.mockImplementation(async () => { calls.push('status'); });
    (sessionRepo as unknown as { softDelete: unknown }).softDelete = vi.fn(async () => { calls.push('softDelete'); });
    const authState = { deleteBySessionId: vi.fn(async () => undefined) } as unknown as ISessionAuthStateRepository;
    const engine = {
      disconnectSession: vi.fn(async () => { calls.push('engine'); }),
    } as unknown as IMessagingEngine & { disconnectSession: ReturnType<typeof vi.fn> };
    const leaseRelease = { execute: vi.fn(async () => { calls.push('release'); }) };
    const uc = new DeleteSessionUseCase(sessionRepo, authState, makeAuditRepo(), engine, [], leaseRelease);
    return { calls, sessionRepo, engine, leaseRelease, uc };
  }

  it('ativa: limpa o pedido antes de desconectar e solta o lease depois', async () => {
    const { calls, sessionRepo, leaseRelease, uc } = setup('CONNECTED');

    await uc.execute({ sessionId: 's1', tenantId: 't1', userId: 'u1' });

    expect(calls).toEqual(['status', 'engine', 'release', 'softDelete']);
    expect(sessionRepo.updateStatus).toHaveBeenCalledWith('s1', 't1', expect.objectContaining({
      status: 'DISCONNECTED', clearConnectRequest: true,
    }));
    expect(leaseRelease.execute).toHaveBeenCalledWith('s1');
  });

  it('falha da engine ainda solta o lease e conclui a exclusão', async () => {
    const { calls, engine, leaseRelease, uc } = setup('CONNECTED');
    engine.disconnectSession.mockRejectedValueOnce(new Error('boom'));

    await uc.execute({ sessionId: 's1', tenantId: 't1', userId: 'u1' });

    expect(leaseRelease.execute).toHaveBeenCalledWith('s1');
    expect(calls).toEqual(['status', 'release', 'softDelete']);
  });

  it('inativa: limpa o pedido mantendo o status, sem engine', async () => {
    const { calls, sessionRepo, engine, uc } = setup('LOGGED_OUT');

    await uc.execute({ sessionId: 's1', tenantId: 't1', userId: 'u1' });

    expect(engine.disconnectSession).not.toHaveBeenCalled();
    expect(sessionRepo.updateStatus).toHaveBeenCalledWith('s1', 't1', {
      status: 'LOGGED_OUT', clearConnectRequest: true,
    });
    expect(calls).toEqual(['status', 'release', 'softDelete']);
  });
});
