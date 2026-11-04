import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BaileysMessagingEngineAdapter } from './BaileysMessagingEngineAdapter';
import { BaileysSessionRegistry } from './BaileysSessionRegistry';
import { SessionLeaseHeldError } from '../../../../../shared/errors/internal/SessionErrors';

// Socket falso (mesmo molde do teste de pareamento): guarda handlers para disparar connection.update
interface FakeSocket {
  handlers: Record<string, (u: unknown) => Promise<void>>;
  authState: { creds: { registered: boolean } };
  end: ReturnType<typeof vi.fn>;
  ev: { on: (e: string, h: (u: unknown) => Promise<void>) => void; removeAllListeners: ReturnType<typeof vi.fn> };
  ws: object;
}
const sockets: FakeSocket[] = [];

vi.mock('@whiskeysockets/baileys', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    default: () => {
      const s: FakeSocket = {
        handlers: {},
        authState: { creds: { registered: true } },
        end: vi.fn(),
        ev: { on: (e, h) => { s.handlers[e] = h; }, removeAllListeners: vi.fn() },
        ws: {},
      };
      sockets.push(s);
      return s;
    },
    fetchLatestBaileysVersion: async () => ({ version: [2, 3000, 0] }),
    makeCacheableSignalKeyStore: (k: unknown) => k,
  };
});
const auth = vi.hoisted(() => ({
  build: vi.fn(async () => ({ state: { creds: {}, keys: {} }, saveCreds: async () => undefined })),
  release: vi.fn(async () => undefined),
  discard: vi.fn(async () => undefined),
  flush: vi.fn(async () => undefined),
}));
vi.mock('./BaileysAuthStatePersistence', () => ({
  buildBaileysAuthState: auth.build,
  flushAllAuthStates: auth.flush,
  releaseAuthState: auth.release,
  discardAuthState: auth.discard,
}));
vi.mock('./BaileysErrorTranslator', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./BaileysErrorTranslator')>();
  return {
    ...actual,
    translateDisconnect: () => ({
      shouldReconnect: true, shouldClearCredentials: false, takenOverByAnotherInstance: false, error: { code: 'X' },
    }),
  };
});

const T = 'tenant-1';
const registry = BaileysSessionRegistry.get();

function make(...answers: boolean[]) {
  const acquire = vi.fn(async () => (answers.length > 1 ? answers.shift()! : answers[0] ?? true));
  const sessionRepo = { updateStatus: vi.fn(async () => undefined), updatePhone: vi.fn() };
  const adapter = new BaileysMessagingEngineAdapter(
    sessionRepo as never, { clearCredentials: vi.fn() } as never, {} as never, {} as never, {} as never,
    { acquire },
  );
  return { adapter, sessionRepo, acquire };
}

beforeEach(() => {
  for (const { sessionId } of registry.getAll()) registry.delete(sessionId);
  sockets.length = 0;
  vi.clearAllMocks();
});
afterEach(() => { vi.useRealTimers(); });

describe('BaileysMessagingEngineAdapter — lease antes de abrir o socket', () => {
  it('connectSession com lease abre o socket depois de adquirir', async () => {
    const { adapter, acquire } = make(true);
    await adapter.connectSession({ sessionId: 's1', tenantId: T });
    expect(acquire).toHaveBeenCalledWith('s1');
    expect(auth.build).toHaveBeenCalledTimes(1);
    expect(sockets).toHaveLength(1);
  });

  it('connectSession sem lease lança SessionLeaseHeldError sem carregar auth nem mudar status', async () => {
    const { adapter, sessionRepo } = make(false);
    await expect(adapter.connectSession({ sessionId: 's1', tenantId: T })).rejects.toBeInstanceOf(SessionLeaseHeldError);
    expect(sockets).toHaveLength(0);
    expect(auth.build).not.toHaveBeenCalled();
    expect(sessionRepo.updateStatus).not.toHaveBeenCalled();
    expect(registry.has('s1')).toBe(false);
  });

  it('reconnectSession sem lease lança SessionLeaseHeldError (503)', async () => {
    const { adapter } = make(false);
    const err = await adapter.reconnectSession({ sessionId: 's1', tenantId: T }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SessionLeaseHeldError);
    expect((err as SessionLeaseHeldError).statusCode).toBe(503);
    expect(sockets).toHaveLength(0);
  });

  it('requestPairingCode sem lease lança SessionLeaseHeldError sem abrir socket', async () => {
    const { adapter, sessionRepo } = make(false);
    await expect(adapter.requestPairingCode({ sessionId: 's1', tenantId: T, phone: '5511999999999' }))
      .rejects.toBeInstanceOf(SessionLeaseHeldError);
    expect(sockets).toHaveLength(0);
    expect(auth.build).not.toHaveBeenCalled();
    expect(sessionRepo.updateStatus).not.toHaveBeenCalled();
  });

  it('reconexão automática sem lease não abre, não lança e não grava FAILED', async () => {
    vi.useFakeTimers();
    const { adapter, sessionRepo, acquire } = make(true, false);
    await adapter.connectSession({ sessionId: 's1', tenantId: T });
    await sockets[0]!.handlers['connection.update']!({ connection: 'close', lastDisconnect: { error: new Error('x') } });
    sessionRepo.updateStatus.mockClear();
    auth.build.mockClear();

    await vi.advanceTimersByTimeAsync(10 * 60_000);

    expect(acquire).toHaveBeenCalledTimes(2);
    expect(sockets).toHaveLength(1);
    expect(auth.build).not.toHaveBeenCalled();
    expect(sessionRepo.updateStatus).not.toHaveBeenCalled();
    expect(registry.has('s1')).toBe(false);
  });
});
