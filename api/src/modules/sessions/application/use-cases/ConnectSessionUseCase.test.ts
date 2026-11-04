import { describe, it, expect, vi } from 'vitest';
import { ConnectSessionUseCase } from './ConnectSessionUseCase';
import { makeAuditRepo, makeSession, makeSessionRepo } from './sessionTestFakes';
import type { IMessagingEngine } from '../../../messaging/domain/contracts/IMessagingEngine';
import type { SessionStatus } from '../../domain/enums/SessionStatus';
import {
  InvalidSessionStateError,
  SessionNotFoundError,
} from '../../../../shared/errors/internal/SessionErrors';

const input = { sessionId: 's1', tenantId: 't1', userId: 'u1' };

function build(status: SessionStatus | null = 'DISCONNECTED') {
  const calls: string[] = [];
  const repo = makeSessionRepo(status ? makeSession({ status }) : null);
  repo.markConnectRequested.mockImplementation(async () => { calls.push('mark'); });
  repo.updateStatus.mockImplementation(async () => { calls.push('status'); return null; });
  const engine = { connectSession: vi.fn(async () => { calls.push('engine'); }) } as unknown as IMessagingEngine & {
    connectSession: ReturnType<typeof vi.fn>;
  };
  return { calls, repo, engine, uc: new ConnectSessionUseCase(repo, makeAuditRepo(), engine) };
}

describe('ConnectSessionUseCase — pedido de conexão', () => {
  it('ordem: validação → marca → engine', async () => {
    const { calls, repo, engine, uc } = build();
    const out = await uc.execute(input);
    expect(repo.markConnectRequested).toHaveBeenCalledWith('s1', 't1');
    expect(engine.connectSession).toHaveBeenCalledWith({ sessionId: 's1', tenantId: 't1' });
    expect(calls.indexOf('mark')).toBeLessThan(calls.indexOf('engine'));
    expect(out).toEqual({ sessionId: 's1', status: 'CONNECTING' });
  });

  it('também marca a partir de PENDING', async () => {
    const { repo, uc } = build('PENDING');
    await uc.execute(input);
    expect(repo.markConnectRequested).toHaveBeenCalledTimes(1);
  });

  it('estado inválido (CONNECTED) não marca nem chama a engine', async () => {
    const { repo, engine, uc } = build('CONNECTED');
    await expect(uc.execute(input)).rejects.toBeInstanceOf(InvalidSessionStateError);
    expect(repo.markConnectRequested).not.toHaveBeenCalled();
    expect(engine.connectSession).not.toHaveBeenCalled();
  });

  it('sessão inexistente não marca', async () => {
    const { repo, engine, uc } = build(null);
    await expect(uc.execute(input)).rejects.toBeInstanceOf(SessionNotFoundError);
    expect(repo.markConnectRequested).not.toHaveBeenCalled();
    expect(engine.connectSession).not.toHaveBeenCalled();
  });

  it('falha ao marcar não chama a engine', async () => {
    const { repo, engine, uc } = build();
    repo.markConnectRequested.mockRejectedValueOnce(new Error('db'));
    await expect(uc.execute(input)).rejects.toThrow('db');
    expect(engine.connectSession).not.toHaveBeenCalled();
  });
});
