import { describe, expect, it, vi } from 'vitest';
import { AdoptNextSessionUseCase } from './AdoptNextSessionUseCase';
import { LEASE_TTL_MS } from '../../domain/services/sessionLeasePolicy';
import type { SessionAdoptResult } from '../../../messaging/domain/contracts/ISessionSocketControl';

function setup(opts: { local?: string[]; max?: number; adopted?: { id: string; tenantId: string } | null; exhausted?: { id: string; tenantId: string }[] } = {}) {
  const local = opts.local ?? [];
  const adoption = {
    adoptNext: vi.fn(async () => (opts.adopted === undefined ? { id: 's1', tenantId: 't1' } : opts.adopted)),
    failExhausted: vi.fn(async () => opts.exhausted ?? []),
    resetFailures: vi.fn(async () => undefined),
    revertAdoptAttempt: vi.fn(async () => undefined),
    countAwaitingCapacity: vi.fn(async () => 0),
  };
  const engine = {
    adoptSession: vi.fn(async (): Promise<SessionAdoptResult> => 'opened'),
    abortSession: vi.fn(async () => undefined),
  };
  const audit = { create: vi.fn(async () => undefined) };
  const log = { info: vi.fn(), warn: vi.fn() };
  const uc = new AdoptNextSessionUseCase({
    adoption, engine, audit, log,
    listLocal: () => local,
    workerId: 'w1', shard: null, maxSessions: opts.max ?? 2,
  });
  return { uc, adoption, engine, audit, log, local };
}

const msgs = (fn: ReturnType<typeof vi.fn>) => fn.mock.calls.map((c) => c[1]);

describe('AdoptNextSessionUseCase', () => {
  it('cheio não chama adoptNext', async () => {
    const { uc, adoption, engine } = setup({ local: ['a', 'b'], max: 2 });
    expect(await uc.execute()).toBe('full');
    expect(adoption.adoptNext).not.toHaveBeenCalled();
    expect(engine.adoptSession).not.toHaveBeenCalled();
  });

  it('adotada abre pela porta de adoção com o tenant da linha e loga adotada', async () => {
    const { uc, adoption, engine, log } = setup({ local: ['a'], max: 2 });
    expect(await uc.execute()).toBe('adopted');
    expect(adoption.adoptNext).toHaveBeenCalledWith('w1', null, LEASE_TTL_MS);
    expect(engine.adoptSession).toHaveBeenCalledWith('s1', 't1');
    expect(msgs(log.info)).toContain('sessão órfã adotada');
    expect(adoption.revertAdoptAttempt).not.toHaveBeenCalled();
  });

  it('nada a adotar sai sem abrir', async () => {
    const { uc, engine } = setup({ adopted: null });
    expect(await uc.execute()).toBe('none');
    expect(engine.adoptSession).not.toHaveBeenCalled();
  });

  it('teto cheio na adoção (corrida): solta o lease e reverte o contador; nada vai a FAILED', async () => {
    const { uc, engine, adoption, audit, local, log } = setup({ local: ['a'], max: 2 });
    engine.adoptSession.mockImplementationOnce(async () => { local.push('b'); return 'held'; });
    expect(await uc.execute()).toBe('released');
    expect(adoption.revertAdoptAttempt).toHaveBeenCalledWith('s1', 'w1');
    expect(audit.create).not.toHaveBeenCalled();
    expect(log.info).toHaveBeenCalledWith(expect.objectContaining({ reason: 'full' }), expect.any(String));
    expect(msgs(log.info)).not.toContain('sessão órfã adotada');
  });

  it('lease de outro dono: devolve e reverte (held)', async () => {
    const { uc, engine, adoption, log } = setup();
    engine.adoptSession.mockResolvedValueOnce('held');
    expect(await uc.execute()).toBe('released');
    expect(adoption.revertAdoptAttempt).toHaveBeenCalledWith('s1', 'w1');
    expect(log.info).toHaveBeenCalledWith(expect.objectContaining({ reason: 'held' }), expect.any(String));
  });

  it('5 corridas perdidas seguidas não contam tentativa: revertidas todas', async () => {
    const { uc, engine, adoption } = setup();
    engine.adoptSession.mockResolvedValue('held');
    for (let i = 0; i < 5; i++) expect(await uc.execute()).toBe('released');
    expect(adoption.revertAdoptAttempt).toHaveBeenCalledTimes(5);
  });

  it('falha ao reverter só loga', async () => {
    const { uc, engine, adoption, log } = setup();
    engine.adoptSession.mockResolvedValueOnce('held');
    adoption.revertAdoptAttempt.mockRejectedValueOnce(new Error('db'));
    expect(await uc.execute()).toBe('released');
    expect(log.warn).toHaveBeenCalled();
  });

  it('abertura cancelada não loga adotada nem reverte', async () => {
    const { uc, engine, adoption, log } = setup();
    engine.adoptSession.mockResolvedValueOnce('cancelled');
    expect(await uc.execute()).toBe('cancelled');
    expect(msgs(log.info)).not.toContain('sessão órfã adotada');
    expect(adoption.revertAdoptAttempt).not.toHaveBeenCalled();
  });

  it.each([
    ['error', async (): Promise<SessionAdoptResult> => 'error'],
    ['lança', async (): Promise<SessionAdoptResult> => { throw new Error('boom'); }],
  ])('abertura com %s → failed, só loga (tentativa mantida)', async (_n, impl) => {
    const { uc, engine, adoption, audit, log } = setup();
    engine.adoptSession.mockImplementationOnce(impl);
    expect(await uc.execute()).toBe('failed');
    expect(adoption.revertAdoptAttempt).not.toHaveBeenCalled();
    expect(adoption.resetFailures).not.toHaveBeenCalled();
    expect(audit.create).not.toHaveBeenCalled();
    expect(log.warn).toHaveBeenCalled();
  });

  it('cancel() solta o tick sem esperar a abertura e pede abort onlyAuto', async () => {
    const { uc, engine, log } = setup();
    engine.adoptSession.mockImplementationOnce(() => new Promise(() => undefined)); // abertura de 60 s
    const p = uc.execute();
    await vi.waitFor(() => expect(engine.adoptSession).toHaveBeenCalled());
    uc.cancel();
    expect(await p).toBe('cancelled');
    expect(engine.abortSession).toHaveBeenCalledWith('s1', { onlyAuto: true });
    expect(msgs(log.info)).not.toContain('sessão órfã adotada');
  });

  it('cancel() durante adoptNext não abre', async () => {
    const { uc, engine, adoption } = setup();
    let go!: () => void;
    adoption.adoptNext.mockImplementationOnce(async () => { await new Promise<void>((r) => { go = r; }); return { id: 's1', tenantId: 't1' }; });
    const p = uc.execute();
    await vi.waitFor(() => expect(go).toBeTypeOf('function'));
    uc.cancel();
    go();
    expect(await p).toBe('cancelled');
    expect(engine.adoptSession).not.toHaveBeenCalled();
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
    expect(engine.adoptSession).toHaveBeenCalledTimes(1);
  });
});
