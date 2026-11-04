import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TelegramMessagingEngineAdapter } from './TelegramMessagingEngineAdapter';
import type { TelegramAuthStatePersistence } from './TelegramAuthStatePersistence';
import { SessionLeaseHeldError } from '../../../../../shared/errors/internal/SessionErrors';

// Cliente GramJS falso: só conta quantos foram criados
const fake = vi.hoisted(() => ({
  created: 0,
  destroyed: 0,
  authorized: true,
  connect: null as null | (() => Promise<void>),
}));

vi.mock('telegram', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  class FakeClient {
    connected = true;
    session = { save: () => 'STRING_SESSION' };
    constructor() { fake.created += 1; }
    async connect() { return fake.connect?.(); }
    async checkAuthorization() { return fake.authorized; }
    async getMe() { return { phone: '551199' }; }
    async destroy() { fake.destroyed += 1; }
    addEventHandler = vi.fn();
    signInUserWithQrCode = vi.fn(() => new Promise(() => undefined)); // login por QR fica pendente
  }
  return { ...actual, TelegramClient: FakeClient };
});

const T = 'tenant-1';

function make(granted: boolean) {
  const sessionRepo = { updateStatus: vi.fn(async () => undefined), updatePhone: vi.fn(async () => undefined) };
  const auth = { load: vi.fn(async () => null), save: vi.fn(async () => undefined), clear: vi.fn(async () => undefined) };
  const leaseGate = { acquire: vi.fn(async () => granted), release: vi.fn(async () => undefined) };
  const adapter = new TelegramMessagingEngineAdapter(
    { apiId: 1, apiHash: 'h' },
    sessionRepo as never,
    auth as unknown as TelegramAuthStatePersistence,
    { findActiveByGroupAndSession: vi.fn() } as never,
    leaseGate,
  );
  return { adapter, sessionRepo, leaseGate, auth };
}

describe('TelegramMessagingEngineAdapter — lease antes de abrir cliente', () => {
  beforeEach(() => {
    fake.created = 0;
    fake.destroyed = 0;
    fake.authorized = true;
    fake.connect = null;
  });

  it.each([
    ['connectSession', (a: TelegramMessagingEngineAdapter) => a.connectSession({ sessionId: 's1', tenantId: T })],
    ['reconnectSession', (a: TelegramMessagingEngineAdapter) => a.reconnectSession({ sessionId: 's1', tenantId: T })],
    ['requestLoginCode', (a: TelegramMessagingEngineAdapter) => a.requestLoginCode({ sessionId: 's1', tenantId: T, phone: '5511999' })],
  ])('%s com lease negado: nenhum cliente, status intacto, SessionLeaseHeldError', async (_name, call) => {
    const { adapter, sessionRepo, leaseGate } = make(false);
    await expect(call(adapter)).rejects.toBeInstanceOf(SessionLeaseHeldError);
    expect(leaseGate.acquire).toHaveBeenCalledWith('s1');
    expect(fake.created).toBe(0);
    expect(sessionRepo.updateStatus).not.toHaveBeenCalled();
    expect(adapter.listLocalSessionIds()).toEqual([]);
  });

  it('lease negado não derruba o cliente local já aberto', async () => {
    const { adapter, leaseGate } = make(true);
    await adapter.connectSession({ sessionId: 's1', tenantId: T });
    leaseGate.acquire.mockResolvedValue(false);
    await expect(adapter.reconnectSession({ sessionId: 's1', tenantId: T })).rejects.toBeInstanceOf(SessionLeaseHeldError);
    expect(fake.created).toBe(1);
    expect(adapter.listLocalSessionIds()).toEqual(['s1']);
  });

  it('lease concedido: adquire antes de criar o cliente e conecta', async () => {
    const { adapter, sessionRepo, leaseGate } = make(true);
    leaseGate.acquire.mockImplementation(async () => {
      expect(fake.created).toBe(0);
      return true;
    });
    await adapter.connectSession({ sessionId: 's1', tenantId: T });
    expect(leaseGate.acquire).toHaveBeenCalledTimes(1);
    expect(fake.created).toBe(1);
    expect(sessionRepo.updateStatus).toHaveBeenCalledWith('s1', T, { status: 'CONNECTING' });
  });

  it('renovação durante a abertura vê a sessão como local (entre acquire e registry.set)', async () => {
    const { adapter, auth } = make(true);
    let release!: () => void;
    let seen: string[] = [];
    auth.load.mockImplementationOnce(async () => {
      seen = adapter.listLocalSessionIds();
      await new Promise<void>((r) => { release = r; });
      return null;
    });
    const p = adapter.connectSession({ sessionId: 's1', tenantId: T });
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    expect(seen).toEqual(['s1']);
    expect(fake.created).toBe(0);
    release();
    await p;
    expect(adapter.listLocalSessionIds()).toEqual(['s1']);
  });

  it('falha na abertura tira a sessão do conjunto "abrindo"', async () => {
    const { adapter, auth } = make(true);
    auth.load.mockRejectedValueOnce(new Error('cipher down'));
    await expect(adapter.connectSession({ sessionId: 's1', tenantId: T })).rejects.toThrow();
    expect(adapter.listLocalSessionIds()).toEqual([]);
  });

  /** auth.load fica parado até `go()`: janela entre o acquire e o registry.set. */
  function holdLoad(auth: ReturnType<typeof make>['auth']) {
    let go!: () => void;
    auth.load.mockImplementationOnce(async () => {
      await new Promise<void>((r) => { go = r; });
      return null;
    });
    return { go: () => go(), started: () => vi.waitFor(() => expect(go).toBeTypeOf('function')) };
  }

  it('abort durante a abertura: cliente descartado, não registrado, sem status nem lease solto', async () => {
    const { adapter, sessionRepo, auth, leaseGate } = make(true);
    const hold = holdLoad(auth);
    const p = adapter.connectSession({ sessionId: 's1', tenantId: T }).catch((e: unknown) => e);
    await hold.started();
    await adapter.abortSession('s1');
    hold.go();
    expect(await p).toBeInstanceOf(SessionLeaseHeldError);
    expect(fake.created).toBe(1);
    expect(fake.destroyed).toBe(1);
    expect(adapter.listLocalSessionIds()).toEqual([]);
    expect(sessionRepo.updateStatus).not.toHaveBeenCalled();
    expect(auth.save).not.toHaveBeenCalled();
    expect(auth.clear).not.toHaveBeenCalled();
    expect(leaseGate.release).not.toHaveBeenCalled();
    expect(await adapter.resumeSession('s1')).toBe(false);
  });

  it('suspend durante a abertura: cliente descartado, não registrado, sem status e retomável', async () => {
    const { adapter, sessionRepo, auth, leaseGate } = make(true);
    const hold = holdLoad(auth);
    const p = adapter.connectSession({ sessionId: 's1', tenantId: T }).catch((e: unknown) => e);
    await hold.started();
    await adapter.suspendSession('s1');
    hold.go();
    expect(await p).toBeInstanceOf(SessionLeaseHeldError);
    expect(fake.destroyed).toBe(1);
    expect(adapter.listLocalSessionIds()).toEqual([]);
    expect(sessionRepo.updateStatus).not.toHaveBeenCalled();
    expect(leaseGate.release).not.toHaveBeenCalled();
    // Retomável: a marca de suspensa ficou (sem StringSession, a reabertura cai no login por QR)
    expect(await adapter.resumeSession('s1')).toBe(true);
    expect(fake.created).toBe(2);
  });

  it('abort durante o connect: não grava FAILED nem solta o lease', async () => {
    const { adapter, sessionRepo, leaseGate } = make(true);
    let fail!: (e: Error) => void;
    fake.connect = () => new Promise<void>((_r, rej) => { fail = rej; });
    const p = adapter.connectSession({ sessionId: 's1', tenantId: T }).catch((e: unknown) => e);
    await vi.waitFor(() => expect(fail).toBeTypeOf('function'));
    await adapter.abortSession('s1');
    fail(new Error('destroyed'));
    expect(await p).toBeInstanceOf(SessionLeaseHeldError);
    expect(sessionRepo.updateStatus).not.toHaveBeenCalledWith('s1', T, expect.objectContaining({ status: 'FAILED' }));
    expect(leaseGate.release).not.toHaveBeenCalled();
  });

  it('erro depois do acquire solta o lease (carga da StringSession)', async () => {
    const { adapter, auth, leaseGate } = make(true);
    auth.load.mockRejectedValueOnce(new Error('cipher down'));
    await expect(adapter.connectSession({ sessionId: 's1', tenantId: T })).rejects.toThrow();
    expect(leaseGate.release).toHaveBeenCalledWith('s1');
  });

  it('connect com erro solta o lease e grava FAILED', async () => {
    const { adapter, sessionRepo, leaseGate } = make(true);
    fake.connect = async () => { throw new Error('network'); };
    await expect(adapter.connectSession({ sessionId: 's1', tenantId: T })).rejects.toThrow();
    expect(sessionRepo.updateStatus).toHaveBeenCalledWith('s1', T, expect.objectContaining({ status: 'FAILED' }));
    expect(leaseGate.release).toHaveBeenCalledWith('s1');
    expect(adapter.listLocalSessionIds()).toEqual([]);
  });

  it('lease negado não chama release', async () => {
    const { adapter, leaseGate } = make(false);
    await expect(adapter.connectSession({ sessionId: 's1', tenantId: T })).rejects.toBeInstanceOf(SessionLeaseHeldError);
    expect(leaseGate.release).not.toHaveBeenCalled();
  });
});
