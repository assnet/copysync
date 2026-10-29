import { describe, expect, it, vi } from 'vitest';
import { DeleteSessionUseCase } from './DeleteSessionUseCase';
import { makeAuditRepo, makeSession, makeSessionRepo } from './sessionTestFakes';
import type { ISessionAuthStateRepository } from '../../domain/contracts/ISessionAuthStateRepository';
import type { IMessagingEngine } from '../../../messaging/domain/contracts/IMessagingEngine';

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
});
