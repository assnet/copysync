import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BaileysMessagingEngineAdapter } from './BaileysMessagingEngineAdapter';
import { BaileysSessionRegistry } from './BaileysSessionRegistry';

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
  release: vi.fn(async () => undefined),
  discard: vi.fn(async () => undefined),
  flush: vi.fn(async () => undefined),
}));
vi.mock('./BaileysAuthStatePersistence', () => ({
  buildBaileysAuthState: async () => ({ state: { creds: {}, keys: {} }, saveCreds: async () => undefined }),
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

function make() {
  const sessionRepo = { updateStatus: vi.fn(async () => undefined), updatePhone: vi.fn() };
  const adapter = new BaileysMessagingEngineAdapter(
    sessionRepo as never, { clearCredentials: vi.fn() } as never, {} as never, {} as never, {} as never,
  );
  return { adapter, sessionRepo };
}

beforeEach(() => {
  for (const { sessionId } of registry.getAll()) registry.delete(sessionId);
  sockets.length = 0;
  vi.clearAllMocks();
});
afterEach(() => { vi.useRealTimers(); });

describe('BaileysMessagingEngineAdapter — controle de socket (lease)', () => {
  it('abortSession fecha o socket e descarta o auth state sem gravar status nem chaves', async () => {
    const { adapter, sessionRepo } = make();
    await adapter.connectSession({ sessionId: 's1', tenantId: T });
    sessionRepo.updateStatus.mockClear();
    const sock = sockets[0]!;

    await adapter.abortSession('s1');

    expect(sock.ev.removeAllListeners).toHaveBeenCalled();
    expect(sock.end).toHaveBeenCalledTimes(1);
    expect(registry.has('s1')).toBe(false);
    expect(auth.discard).toHaveBeenCalledWith('s1');
    expect(auth.release).not.toHaveBeenCalled();
    expect(sessionRepo.updateStatus).not.toHaveBeenCalled();
  });

  it('abortSession cancela a reconexão automática pendente', async () => {
    vi.useFakeTimers();
    const { adapter } = make();
    await adapter.connectSession({ sessionId: 's1', tenantId: T });
    await sockets[0]!.handlers['connection.update']!({ connection: 'close', lastDisconnect: { error: new Error('x') } });
    expect(registry.has('s1')).toBe(false);

    await adapter.abortSession('s1');
    await vi.advanceTimersByTimeAsync(10 * 60_000);

    expect(sockets).toHaveLength(1);
    expect(registry.has('s1')).toBe(false);
  });

  it('abortSession sem socket local não grava status', async () => {
    const { adapter, sessionRepo } = make();
    await adapter.abortSession('nada');
    expect(sessionRepo.updateStatus).not.toHaveBeenCalled();
    expect(auth.release).not.toHaveBeenCalled();
  });

  it('closeAllSockets fecha todos sem descartar handles (o flush seguinte ainda grava)', async () => {
    const { adapter, sessionRepo } = make();
    await adapter.connectSession({ sessionId: 's1', tenantId: T });
    await adapter.connectSession({ sessionId: 's2', tenantId: T });
    sessionRepo.updateStatus.mockClear();

    await adapter.closeAllSockets();

    expect(sockets.every((s) => s.end.mock.calls.length === 1)).toBe(true);
    expect(sockets.every((s) => s.ev.removeAllListeners.mock.calls.length > 0)).toBe(true);
    expect(adapter.listLocalSessionIds()).toEqual([]);
    expect(auth.discard).not.toHaveBeenCalled();
    expect(auth.release).not.toHaveBeenCalled();
    expect(auth.flush).not.toHaveBeenCalled();
    expect(sessionRepo.updateStatus).not.toHaveBeenCalled();
  });

  it('closeAllSockets cancela reconexões pendentes', async () => {
    vi.useFakeTimers();
    const { adapter } = make();
    await adapter.connectSession({ sessionId: 's1', tenantId: T });
    await sockets[0]!.handlers['connection.update']!({ connection: 'close', lastDisconnect: { error: new Error('x') } });

    await adapter.closeAllSockets();
    await vi.advanceTimersByTimeAsync(10 * 60_000);

    expect(sockets).toHaveLength(1);
  });

  it('listLocalSessionIds devolve as sessões com socket no registry', async () => {
    const { adapter } = make();
    expect(adapter.listLocalSessionIds()).toEqual([]);
    await adapter.connectSession({ sessionId: 's1', tenantId: T });
    await adapter.connectSession({ sessionId: 's2', tenantId: T });
    expect(adapter.listLocalSessionIds().sort()).toEqual(['s1', 's2']);
  });
});
