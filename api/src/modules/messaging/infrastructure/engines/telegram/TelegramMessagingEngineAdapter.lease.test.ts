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

  it('abort durante a abertura: cliente descartado, não registrado, sem status; lease solto condicionado ao dono', async () => {
    const { adapter, sessionRepo, auth, leaseGate } = make(true);
    const hold = holdLoad(auth);
    const p = adapter.connectSession({ sessionId: 's1', tenantId: T }).catch((e: unknown) => e);
    await hold.started();
    await adapter.abortSession('s1');
    hold.go();
    expect(await p).toBeInstanceOf(SessionLeaseHeldError);
    expect(fake.created).toBe(0); // cancelada antes de criar o cliente
    expect(adapter.listLocalSessionIds()).toEqual([]);
    expect(sessionRepo.updateStatus).not.toHaveBeenCalled();
    expect(auth.save).not.toHaveBeenCalled();
    expect(auth.clear).not.toHaveBeenCalled();
    // Acquire que assentou antes do abort não fica preso até o TTL (no-op se o lease é de outro)
    expect(leaseGate.release).toHaveBeenCalledExactlyOnceWith('s1');
    expect(await adapter.resumeSession('s1')).toBe('gone');
  });

  it('suspend durante a abertura: cliente descartado, não registrado, sem status e retomável', async () => {
    const { adapter, sessionRepo, auth, leaseGate } = make(true);
    const hold = holdLoad(auth);
    const p = adapter.connectSession({ sessionId: 's1', tenantId: T }).catch((e: unknown) => e);
    await hold.started();
    await adapter.suspendSession('s1');
    hold.go();
    expect(await p).toBeInstanceOf(SessionLeaseHeldError);
    expect(fake.created).toBe(0);
    expect(adapter.listLocalSessionIds()).toEqual([]);
    expect(sessionRepo.updateStatus).not.toHaveBeenCalled();
    expect(leaseGate.release).not.toHaveBeenCalled();
    // Retomável: a marca de suspensa ficou (sem StringSession, a reabertura cai no login por QR)
    expect(await adapter.resumeSession('s1')).toBe('resumed');
    expect(fake.created).toBe(1);
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

  it('2 opens de usuário seguidos (cliques repetidos) = 1 cliente: a 2ª cancela a 1ª, sem fila', async () => {
    const { adapter, auth, leaseGate } = make(true);
    fake.authorized = false; // login por QR: o cliente fica registrado
    let go!: () => void;
    auth.load.mockImplementationOnce(() => new Promise<null>((r) => { go = () => r(null); }));
    const first = adapter.connectSession({ sessionId: 's1', tenantId: T });
    await vi.waitFor(() => expect(go).toBeTypeOf('function'));
    const second = adapter.connectSession({ sessionId: 's1', tenantId: T });
    await Promise.resolve();
    expect(leaseGate.acquire).toHaveBeenCalledTimes(1); // a 2ª espera a 1ª assentar
    go();
    expect(await first).toEqual({}); // cancelada sem erro
    await second;
    expect(fake.created).toBe(1);
    expect(fake.destroyed).toBe(0);
    expect(adapter.listLocalSessionIds()).toEqual(['s1']);
  });

  it('3 cliques seguidos: só a última abre', async () => {
    const { adapter, auth } = make(true);
    fake.authorized = false;
    let go!: () => void;
    auth.load.mockImplementationOnce(() => new Promise<null>((r) => { go = () => r(null); }));
    const calls = [adapter.connectSession({ sessionId: 's1', tenantId: T })];
    await vi.waitFor(() => expect(go).toBeTypeOf('function'));
    calls.push(adapter.connectSession({ sessionId: 's1', tenantId: T }), adapter.connectSession({ sessionId: 's1', tenantId: T }));
    go();
    await Promise.all(calls);
    expect(fake.created).toBe(1);
    expect(adapter.listLocalSessionIds()).toEqual(['s1']);
  });

  it('connect do usuário com retomada pendurada no acquire não fica na fila: cancela e abre o seu', async () => {
    const { adapter, leaseGate } = make(true);
    fake.authorized = false;
    await adapter.connectSession({ sessionId: 's1', tenantId: T });
    await adapter.suspendSession('s1');
    let free!: (v: boolean) => void;
    leaseGate.acquire.mockImplementationOnce(() => new Promise<boolean>((r) => { free = r; }));
    const resume = adapter.resumeSession('s1');
    await vi.waitFor(() => expect(free).toBeTypeOf('function'));
    const user = adapter.connectSession({ sessionId: 's1', tenantId: T });
    free(true); // o acquire da retomada assenta (o repo tem prazo): a do usuário segue
    await user;
    expect(await resume).toBe('gone'); // o connect do usuário apagou a suspensão
    expect(fake.created).toBe(2); // 1º connect + o do usuário; a retomada não criou cliente
    expect(adapter.listLocalSessionIds()).toEqual(['s1']);
  });

  it('retomada (auto) com abertura do usuário em curso espera e não abre 2º cliente', async () => {
    const { adapter, auth, leaseGate } = make(true);
    fake.authorized = false;
    await adapter.connectSession({ sessionId: 's1', tenantId: T });
    await adapter.suspendSession('s1');
    let go!: () => void;
    auth.load.mockImplementationOnce(() => new Promise<null>((r) => { go = () => r(null); })); // abertura do usuário
    auth.load.mockImplementationOnce(async () => null); // load do reopen (auto)
    const user = adapter.requestLoginCode({ sessionId: 's1', tenantId: T, phone: '5511999' }).catch(() => undefined);
    await vi.waitFor(() => expect(go).toBeTypeOf('function'));
    const resume = adapter.resumeSession('s1');
    go();
    await user;
    expect(await resume).toBe('resumed');
    expect(leaseGate.acquire).toHaveBeenCalledTimes(2);
    expect(fake.created).toBe(2);
  });

  it('registry.set sobre entrada viva de outro cliente derruba o antigo antes', async () => {
    const { adapter, auth } = make(true);
    fake.authorized = false;
    let go!: () => void;
    auth.load.mockImplementationOnce(() => new Promise<null>((r) => { go = () => r(null); }));
    const p = adapter.connectSession({ sessionId: 's1', tenantId: T });
    await vi.waitFor(() => expect(go).toBeTypeOf('function'));
    const destroy = vi.fn(async () => undefined);
    const registry = (adapter as unknown as { registry: { set: (id: string, e: unknown) => void; nextEpoch: () => number } }).registry;
    registry.set('s1', { client: { destroy }, tenantId: T, epoch: registry.nextEpoch(), pending: null, latestQr: null, phone: null, sentIds: new Set() });
    go();
    await p;
    expect(destroy).toHaveBeenCalledTimes(1);
    expect(fake.created).toBe(1);
    expect(adapter.listLocalSessionIds()).toEqual(['s1']);
  });
});
