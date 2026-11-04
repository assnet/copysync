import { describe, it, expect, vi } from 'vitest';
import { ReconnectSessionUseCase } from './ReconnectSessionUseCase';
import { makeAuditRepo, makeSession, makeSessionRepo } from './sessionTestFakes';
import type { IMessagingEngine } from '../../../messaging/domain/contracts/IMessagingEngine';
import type { SessionStatus } from '../../domain/enums/SessionStatus';
import {
  InvalidSessionStateError,
  SessionNotFoundError,
  SessionLeaseHeldError,
} from '../../../../shared/errors/internal/SessionErrors';

const input = { sessionId: 's1', tenantId: 't1', userId: 'u1' };

function build(status: SessionStatus | null = 'DISCONNECTED') {
  const calls: string[] = [];
  const repo = makeSessionRepo(status ? makeSession({ status }) : null);
  repo.markConnectRequested.mockImplementation(async () => { calls.push('mark'); });
  repo.updateStatus.mockImplementation(async () => { calls.push('status'); return null; });
  const engine = { reconnectSession: vi.fn(async () => { calls.push('engine'); }) } as unknown as IMessagingEngine & {
    reconnectSession: ReturnType<typeof vi.fn>;
  };
  return { calls, repo, engine, uc: new ReconnectSessionUseCase(repo, makeAuditRepo(), engine) };
}

describe('ReconnectSessionUseCase — pedido de conexão', () => {
  it('ordem: validação → marca → engine', async () => {
    const { calls, repo, engine, uc } = build();
    const out = await uc.execute(input);
    expect(repo.markConnectRequested).toHaveBeenCalledWith('s1', 't1');
    expect(engine.reconnectSession).toHaveBeenCalledWith({ sessionId: 's1', tenantId: 't1' });
    expect(calls.indexOf('mark')).toBeLessThan(calls.indexOf('engine'));
    expect(out).toEqual({ sessionId: 's1', status: 'CONNECTING' });
  });

  it('também marca a partir de LOGGED_OUT', async () => {
    const { repo, uc } = build('LOGGED_OUT');
    await uc.execute(input);
    expect(repo.markConnectRequested).toHaveBeenCalledTimes(1);
  });

  it('estado inválido (PENDING) não marca nem chama a engine', async () => {
    const { repo, engine, uc } = build('PENDING');
    await expect(uc.execute(input)).rejects.toBeInstanceOf(InvalidSessionStateError);
    expect(repo.markConnectRequested).not.toHaveBeenCalled();
    expect(engine.reconnectSession).not.toHaveBeenCalled();
  });

  it('sessão inexistente não marca', async () => {
    const { repo, engine, uc } = build(null);
    await expect(uc.execute(input)).rejects.toBeInstanceOf(SessionNotFoundError);
    expect(repo.markConnectRequested).not.toHaveBeenCalled();
    expect(engine.reconnectSession).not.toHaveBeenCalled();
  });

  it('falha ao marcar não chama a engine', async () => {
    const { repo, engine, uc } = build();
    repo.markConnectRequested.mockRejectedValueOnce(new Error('db'));
    await expect(uc.execute(input)).rejects.toThrow('db');
    expect(engine.reconnectSession).not.toHaveBeenCalled();
  });
});

describe('ReconnectSessionUseCase — lease de outro processo', () => {
  it('restaura o status anterior, mantém connectRequestedAt e propaga o 503', async () => {
    const { calls, repo, engine, uc } = build('LOGGED_OUT');
    engine.reconnectSession.mockRejectedValueOnce(new SessionLeaseHeldError('s1'));
    const err = await uc.execute(input).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SessionLeaseHeldError);
    expect((err as SessionLeaseHeldError).statusCode).toBe(503);
    expect(repo.updateStatus).toHaveBeenNthCalledWith(1, 's1', 't1', { status: 'CONNECTING' });
    expect(repo.updateStatus).toHaveBeenLastCalledWith('s1', 't1', { status: 'LOGGED_OUT' });
    expect(repo.updateStatus).toHaveBeenCalledTimes(2);
    expect(repo.markConnectRequested).toHaveBeenCalledTimes(1);
    expect(calls).toEqual(['mark', 'status', 'status']);
  });

  it('falha ao restaurar não troca o erro de lease', async () => {
    const { repo, engine, uc } = build();
    engine.reconnectSession.mockRejectedValueOnce(new SessionLeaseHeldError('s1'));
    repo.updateStatus.mockResolvedValueOnce(null).mockRejectedValueOnce(new Error('db'));
    await expect(uc.execute(input)).rejects.toBeInstanceOf(SessionLeaseHeldError);
  });

  it('outro erro da engine não mexe no status (caminho inalterado)', async () => {
    const { repo, engine, uc } = build();
    engine.reconnectSession.mockRejectedValueOnce(new Error('boom'));
    await expect(uc.execute(input)).rejects.toThrow('boom');
    expect(repo.updateStatus).toHaveBeenCalledTimes(1);
  });
});
