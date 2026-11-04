import { describe, expect, it, vi } from 'vitest';
import { AdoptNextSessionUseCase } from './AdoptNextSessionUseCase';
import { LEASE_TTL_MS } from '../../domain/services/sessionLeasePolicy';
import { SessionLeaseHeldError } from '../../../../shared/errors/internal/SessionErrors';

function setup(opts: { local?: string[]; max?: number; adopted?: { id: string; tenantId: string } | null; exhausted?: { id: string; tenantId: string }[] } = {}) {
  const adoption = {
    adoptNext: vi.fn(async () => (opts.adopted === undefined ? { id: 's1', tenantId: 't1' } : opts.adopted)),
    failExhausted: vi.fn(async () => opts.exhausted ?? []),
    resetFailures: vi.fn(async () => undefined),
    countAwaitingCapacity: vi.fn(async () => 0),
  };
  const engine = { reconnectSession: vi.fn(async () => undefined) };
  const audit = { create: vi.fn(async () => undefined) };
  const log = { info: vi.fn(), warn: vi.fn() };
  const uc = new AdoptNextSessionUseCase({
    adoption, engine, audit, log,
    listLocal: () => opts.local ?? [],
    workerId: 'w1', shard: null, maxSessions: opts.max ?? 2,
  });
  return { uc, adoption, engine, audit, log };
}

describe('AdoptNextSessionUseCase', () => {
  it('cheio não chama adoptNext', async () => {
    const { uc, adoption, engine } = setup({ local: ['a', 'b'], max: 2 });
    expect(await uc.execute()).toBe('full');
    expect(adoption.adoptNext).not.toHaveBeenCalled();
    expect(engine.reconnectSession).not.toHaveBeenCalled();
  });

  it('adotada chama reconnect com o tenant da linha', async () => {
    const { uc, adoption, engine } = setup({ local: ['a'], max: 2 });
    expect(await uc.execute()).toBe('adopted');
    expect(adoption.adoptNext).toHaveBeenCalledWith('w1', null, LEASE_TTL_MS);
    expect(engine.reconnectSession).toHaveBeenCalledWith({ sessionId: 's1', tenantId: 't1' });
  });

  it('nada a adotar sai sem reconectar', async () => {
    const { uc, engine } = setup({ adopted: null });
    expect(await uc.execute()).toBe('none');
    expect(engine.reconnectSession).not.toHaveBeenCalled();
  });

  it.each([new Error('boom'), new SessionLeaseHeldError('s1')])('reconnect lança → só loga, nada gravado', async (err) => {
    const { uc, engine, adoption, audit, log } = setup();
    engine.reconnectSession.mockRejectedValueOnce(err);
    expect(await uc.execute()).toBe('failed');
    expect(adoption.resetFailures).not.toHaveBeenCalled();
    expect(adoption.adoptNext).toHaveBeenCalledTimes(1);
    expect(audit.create).not.toHaveBeenCalled();
    expect(log.warn).toHaveBeenCalled();
  });

  it('audita cada esgotada antes de adotar, mesmo cheio', async () => {
    const { uc, audit, adoption } = setup({ local: ['a', 'b'], exhausted: [{ id: 'x', tenantId: 't9' }, { id: 'y', tenantId: 't8' }] });
    audit.create.mockRejectedValueOnce(new Error('audit off'));
    expect(await uc.execute()).toBe('full');
    expect(audit.create).toHaveBeenCalledTimes(2);
    expect(audit.create).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 't8', meta: expect.objectContaining({ sessionId: 'y', status: 'FAILED' }) }));
    expect(adoption.adoptNext).not.toHaveBeenCalled();
  });

  it('falha em failExhausted não impede a adoção', async () => {
    const { uc, adoption, engine } = setup();
    adoption.failExhausted.mockRejectedValueOnce(new Error('db'));
    expect(await uc.execute()).toBe('adopted');
    expect(engine.reconnectSession).toHaveBeenCalledTimes(1);
  });
});
