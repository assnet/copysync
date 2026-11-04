import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TelegramMessagingEngineAdapter } from './TelegramMessagingEngineAdapter';
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

const T = 'tenant-1';

function make() {
  const sessionRepo = { updateStatus: vi.fn(async () => undefined), updatePhone: vi.fn(async () => undefined) };
  const auth = { load: vi.fn(async () => null), save: vi.fn(async () => undefined), clear: vi.fn(async () => undefined) };
  const adapter = new TelegramMessagingEngineAdapter(
    { apiId: 1, apiHash: 'h' },
    sessionRepo as never,
    auth as unknown as TelegramAuthStatePersistence,
    { findActiveByGroupAndSession: vi.fn() } as never,
  );
  return { adapter, sessionRepo, auth };
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
