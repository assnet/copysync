import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TelegramMessagingEngineAdapter } from './TelegramMessagingEngineAdapter';
import type { TelegramAuthStatePersistence } from './TelegramAuthStatePersistence';
import { SessionLeaseHeldError } from '../../../../../shared/errors/internal/SessionErrors';

// Cliente GramJS falso: só conta quantos foram criados
const fake = vi.hoisted(() => ({ created: 0, authorized: true }));

vi.mock('telegram', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  class FakeClient {
    connected = true;
    session = { save: () => 'STRING_SESSION' };
    constructor() { fake.created += 1; }
    async connect() { return undefined; }
    async checkAuthorization() { return fake.authorized; }
    async getMe() { return { phone: '551199' }; }
    async destroy() { return undefined; }
    addEventHandler = vi.fn();
  }
  return { ...actual, TelegramClient: FakeClient };
});

const T = 'tenant-1';

function make(granted: boolean) {
  const sessionRepo = { updateStatus: vi.fn(async () => undefined), updatePhone: vi.fn(async () => undefined) };
  const auth = { load: vi.fn(async () => null), save: vi.fn(async () => undefined), clear: vi.fn(async () => undefined) };
  const leaseGate = { acquire: vi.fn(async () => granted) };
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
    fake.authorized = true;
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
});
