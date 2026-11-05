import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TelegramMessagingEngineAdapter } from './TelegramMessagingEngineAdapter';
import { EngineTemporarilyUnavailableError } from '../../../../../shared/errors/internal/MessagingErrors';
import type { TelegramAuthStatePersistence } from './TelegramAuthStatePersistence';

// Cliente GramJS falso: `start` pede o código e fica preso até o destroy; `getMe` controlável
const fake = vi.hoisted(() => ({
  authorized: false,
  getMe: null as null | (() => Promise<{ phone?: string }>),
  clients: [] as { destroy: ReturnType<typeof import('vitest').vi.fn> }[],
  failDestroyAt: -1,
}));

vi.mock('telegram', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  class FakeClient {
    connected = true;
    session = { save: () => 'STRING_SESSION' };
    private killed!: (e: unknown) => void;
    private readonly dead = new Promise<never>((_, rej) => { this.killed = rej; });
    destroy = vi.fn(async () => {
      this.killed(new Error('AUTH_USER_CANCEL'));
      if (fake.clients.indexOf(this as never) === fake.failDestroyAt) throw new Error('boom');
    });
    constructor() {
      this.dead.catch(() => undefined);
      fake.clients.push(this as never);
    }
    async connect() { return undefined; }
    async checkAuthorization() { return fake.authorized; }
    async getMe() { return fake.getMe ? fake.getMe() : { phone: '551199' }; }
    addEventHandler = vi.fn();
    async start(opts: { phoneCode: () => Promise<string> }) {
      await Promise.race([opts.phoneCode(), this.dead]);
      await this.dead; // espera a senha/rede para sempre: só o destroy encerra
    }
  }
  return { ...actual, TelegramClient: FakeClient };
});

// StringSession real valida o formato; aqui basta guardar o texto salvo
vi.mock('telegram/sessions', () => ({ StringSession: class { constructor(readonly value: string) {} } }));

const T = 'tenant-1';

function make(gate = { acquire: vi.fn(async () => true) }) {
  const sessionRepo = { updateStatus: vi.fn(async () => undefined), updatePhone: vi.fn(async () => undefined) };
  const auth = { load: vi.fn(async (): Promise<string | null> => null), save: vi.fn(async () => undefined), clear: vi.fn(async () => undefined) };
  const adapter = new TelegramMessagingEngineAdapter(
    { apiId: 1, apiHash: 'h' },
    sessionRepo as never,
    auth as unknown as TelegramAuthStatePersistence,
    { findActiveByGroupAndSession: vi.fn() } as never,
    gate,
  );
  return { adapter, sessionRepo, auth, gate };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('TelegramMessagingEngineAdapter — controle de socket (lease)', () => {
  beforeEach(() => {
    fake.authorized = false;
    fake.getMe = null;
    fake.clients.length = 0;
    fake.failDestroyAt = -1;
  });

  it('abortSession destrói o cliente, rejeita o login pendente e não grava status nem StringSession', async () => {
    const { adapter, sessionRepo, auth } = make();
    await adapter.requestLoginCode({ sessionId: 's1', tenantId: T, phone: '5511999' });
    expect(adapter.listLocalSessionIds()).toEqual(['s1']);
    const step = adapter.submitLoginCode({ sessionId: 's1', tenantId: T, code: '12345' });
    sessionRepo.updateStatus.mockClear();

    await adapter.abortSession('s1');
    await expect(step).rejects.toBeTruthy();
    await flush();

    expect(fake.clients[0].destroy).toHaveBeenCalledTimes(1);
    expect(adapter.listLocalSessionIds()).toEqual([]);
    expect(sessionRepo.updateStatus).not.toHaveBeenCalled();
    expect(auth.save).not.toHaveBeenCalled();
    expect(auth.clear).not.toHaveBeenCalled();
    await expect(adapter.submitLoginCode({ sessionId: 's1', tenantId: T, code: '1' })).rejects.toBeTruthy();
  });

  it('abort durante o getMe do login: não marca CONNECTED nem registra handler', async () => {
    fake.authorized = true;
    let release!: () => void;
    fake.getMe = () => new Promise((r) => { release = () => r({ phone: '55' }); });
    const { adapter, sessionRepo } = make();
    const connecting = adapter.connectSession({ sessionId: 's1', tenantId: T });
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    sessionRepo.updateStatus.mockClear();

    await adapter.abortSession('s1');
    release();
    await connecting;

    expect(sessionRepo.updateStatus).not.toHaveBeenCalled();
    expect((fake.clients[0] as unknown as { addEventHandler: ReturnType<typeof vi.fn> }).addEventHandler).not.toHaveBeenCalled();
  });

  it('abortSession sem cliente local não faz nada', async () => {
    const { adapter, sessionRepo, auth } = make();
    await adapter.abortSession('nope');
    expect(sessionRepo.updateStatus).not.toHaveBeenCalled();
    expect(auth.save).not.toHaveBeenCalled();
  });

  it('suspendSession destrói o cliente sem auth.clear nem status; resumeSession reconecta pelo caminho normal', async () => {
    fake.authorized = true;
    const { adapter, sessionRepo, auth, gate } = make();
    await adapter.connectSession({ sessionId: 's1', tenantId: T });
    sessionRepo.updateStatus.mockClear();
    auth.save.mockClear();

    await adapter.suspendSession('s1');
    expect(fake.clients[0].destroy).toHaveBeenCalledTimes(1);
    expect(adapter.listLocalSessionIds()).toEqual([]);
    expect(auth.clear).not.toHaveBeenCalled();
    expect(sessionRepo.updateStatus).not.toHaveBeenCalled();

    auth.load.mockResolvedValueOnce('STRING_SESSION');
    gate.acquire.mockClear();
    expect(await adapter.resumeSession('s1')).toBe('resumed');
    expect(gate.acquire).toHaveBeenCalledWith('s1');
    expect(fake.clients).toHaveLength(2);
    expect(sessionRepo.updateStatus).toHaveBeenCalledWith('s1', T, expect.objectContaining({ status: 'CONNECTED' }));
    expect(await adapter.resumeSession('s1')).toBe('gone');
  });

  it('resumeSession com lease de outro processo devolve held e mantém a suspensa até forgetSuspension', async () => {
    fake.authorized = true;
    const { adapter, auth, gate } = make();
    await adapter.connectSession({ sessionId: 's1', tenantId: T });
    await adapter.suspendSession('s1');
    auth.load.mockResolvedValue('STRING_SESSION');
    gate.acquire.mockResolvedValueOnce(false);
    expect(await adapter.resumeSession('s1')).toBe('held');
    expect(fake.clients).toHaveLength(1);
    expect(await adapter.forgetSuspension('s1')).toBe(T);
    expect(await adapter.resumeSession('s1')).toBe('gone');
    expect(gate.acquire).toHaveBeenCalledTimes(2); // connect + 1 resume

    await adapter.connectSession({ sessionId: 's2', tenantId: T });
    await adapter.suspendSession('s2');
    await adapter.abortSession('s2');
    expect(await adapter.resumeSession('s2')).toBe('gone');
    expect(await adapter.resumeSession('nope')).toBe('gone');
  });

  it('acquire com erro de banco na retomada lança (não é held) e mantém a suspensa', async () => {
    fake.authorized = true;
    const gate = { acquire: vi.fn(async () => true), acquireResult: vi.fn(async (): Promise<'acquired' | 'held' | 'error'> => 'acquired') };
    const { adapter, auth } = make(gate);
    await adapter.connectSession({ sessionId: 's1', tenantId: T });
    await adapter.suspendSession('s1');
    auth.load.mockResolvedValue('STRING_SESSION');
    gate.acquireResult.mockResolvedValueOnce('error');
    await expect(adapter.resumeSession('s1')).rejects.toBeInstanceOf(EngineTemporarilyUnavailableError);
    expect(await adapter.resumeSession('s1')).toBe('resumed');
    expect(fake.clients).toHaveLength(2);
  });

  it('resumeSession que falha ao reabrir mantém a suspensa e relança; a 2ª chamada reconecta', async () => {
    fake.authorized = true;
    const { adapter, auth } = make();
    await adapter.connectSession({ sessionId: 's1', tenantId: T });
    await adapter.suspendSession('s1');
    auth.load.mockRejectedValueOnce(new Error('db'));

    await expect(adapter.resumeSession('s1')).rejects.toThrow('db');
    expect(adapter.listLocalSessionIds()).toEqual([]);

    auth.load.mockResolvedValueOnce('STRING_SESSION');
    expect(await adapter.resumeSession('s1')).toBe('resumed');
    expect(fake.clients).toHaveLength(2);
  });

  it('disconnect durante o resume que falha devolve gone e não devolve a sessão à suspensão', async () => {
    fake.authorized = true;
    const { adapter, auth } = make();
    await adapter.connectSession({ sessionId: 's1', tenantId: T });
    await adapter.suspendSession('s1');
    let fail!: (e: Error) => void;
    auth.load.mockImplementationOnce(() => new Promise((_, rej) => { fail = rej; }));

    const p = adapter.resumeSession('s1');
    await vi.waitFor(() => expect(fail).toBeDefined());
    await adapter.disconnectSession({ sessionId: 's1', tenantId: T });
    fail(new Error('db'));

    expect(await p).toBe('gone');
    expect(await adapter.resumeSession('s1')).toBe('gone');
    expect(fake.clients).toHaveLength(1);
  });

  it('closeAllSockets destrói todos em paralelo, mesmo com falha de um, sem gravar nada', async () => {
    fake.failDestroyAt = 0;
    const { adapter, sessionRepo, auth } = make();
    await adapter.requestLoginCode({ sessionId: 's1', tenantId: T, phone: '5511999' });
    await adapter.requestLoginCode({ sessionId: 's2', tenantId: T, phone: '5511888' });
    expect(adapter.listLocalSessionIds().sort()).toEqual(['s1', 's2']);
    sessionRepo.updateStatus.mockClear();

    await adapter.closeAllSockets();
    await flush();

    expect(fake.clients.every((c) => c.destroy.mock.calls.length === 1)).toBe(true);
    expect(adapter.listLocalSessionIds()).toEqual([]);
    expect(sessionRepo.updateStatus).not.toHaveBeenCalled();
    expect(auth.save).not.toHaveBeenCalled();
    expect(auth.clear).not.toHaveBeenCalled();
  });
});
