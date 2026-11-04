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
  suspend: vi.fn(async () => undefined),
  flush: vi.fn(async () => undefined),
}));
vi.mock('./BaileysAuthStatePersistence', () => ({
  buildBaileysAuthState: auth.build,
  flushAllAuthStates: auth.flush,
  releaseAuthState: auth.release,
  discardAuthState: auth.discard,
  suspendAuthState: auth.suspend,
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
  const release = vi.fn(async () => undefined);
  const sessionRepo = { updateStatus: vi.fn(async () => undefined), updatePhone: vi.fn() };
  const adapter = new BaileysMessagingEngineAdapter(
    sessionRepo as never, { clearCredentials: vi.fn() } as never, {} as never, {} as never, {} as never,
    { acquire, release },
  );
  return { adapter, sessionRepo, acquire, release };
}

/** auth.build fica parado até `go()`: janela entre o acquire e o registry.set. */
function holdBuild() {
  let go!: () => void;
  auth.build.mockImplementationOnce(async () => {
    await new Promise<void>((r) => { go = r; });
    return { state: { creds: {}, keys: {} }, saveCreds: async () => undefined };
  });
  return { go: () => go(), started: () => vi.waitFor(() => expect(go).toBeTypeOf('function')) };
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

  it('renovação durante a abertura vê a sessão como local (entre acquire e registry.set)', async () => {
    const { adapter } = make(true);
    let release!: () => void;
    let seen: string[] = [];
    auth.build.mockImplementationOnce(async () => {
      seen = adapter.listLocalSessionIds();
      await new Promise<void>((r) => { release = r; });
      return { state: { creds: {}, keys: {} }, saveCreds: async () => undefined };
    });
    const p = adapter.connectSession({ sessionId: 's1', tenantId: T });
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    expect(seen).toEqual(['s1']);
    expect(registry.has('s1')).toBe(false);
    release();
    await p;
    expect(adapter.listLocalSessionIds()).toEqual(['s1']);
  });

  it('falha na abertura tira a sessão do conjunto "abrindo"', async () => {
    const { adapter } = make(true);
    auth.build.mockImplementationOnce(async () => { throw new Error('auth state down'); });
    await expect(adapter.connectSession({ sessionId: 's1', tenantId: T })).rejects.toThrow('auth state down');
    expect(adapter.listLocalSessionIds()).toEqual([]);
  });

  it('abort durante a abertura: socket fechado, não registrado, sem gravar status nem chaves', async () => {
    const { adapter, sessionRepo, release } = make(true);
    const hold = holdBuild();
    const p = adapter.connectSession({ sessionId: 's1', tenantId: T }).catch((e: unknown) => e);
    await hold.started();
    await adapter.abortSession('s1');
    auth.discard.mockClear();
    hold.go();
    expect(await p).toBeInstanceOf(SessionLeaseHeldError);
    expect(sockets).toHaveLength(1);
    expect(sockets[0]!.end).toHaveBeenCalledTimes(1);
    expect(sockets[0]!.handlers['connection.update']).toBeUndefined();
    expect(registry.has('s1')).toBe(false);
    expect(adapter.listLocalSessionIds()).toEqual([]);
    expect(auth.discard).toHaveBeenCalledWith('s1');
    expect(auth.suspend).not.toHaveBeenCalled();
    expect(sessionRepo.updateStatus).not.toHaveBeenCalled();
    expect(release).not.toHaveBeenCalled(); // lease é de outro: não solta
    expect(await adapter.resumeSession('s1')).toBe(false);
  });

  it('suspend durante a abertura: socket fechado, não registrado, chaves guardadas e retomável', async () => {
    const { adapter, sessionRepo, release } = make(true);
    const hold = holdBuild();
    const p = adapter.connectSession({ sessionId: 's1', tenantId: T }).catch((e: unknown) => e);
    await hold.started();
    await adapter.suspendSession('s1');
    expect(auth.suspend).not.toHaveBeenCalled(); // quem guarda é a abertura, depois do build
    hold.go();
    expect(await p).toBeInstanceOf(SessionLeaseHeldError);
    expect(sockets[0]!.end).toHaveBeenCalledTimes(1);
    expect(registry.has('s1')).toBe(false);
    expect(auth.suspend).toHaveBeenCalledWith('s1');
    expect(auth.discard).not.toHaveBeenCalled();
    expect(sessionRepo.updateStatus).not.toHaveBeenCalled();
    expect(release).not.toHaveBeenCalled();
    expect(await adapter.resumeSession('s1')).toBe(true);
    expect(registry.has('s1')).toBe(true);
    expect(sockets).toHaveLength(2);
  });

  it('abort depois de suspend na mesma abertura: abort vence (descarta, não retoma)', async () => {
    const { adapter } = make(true);
    const hold = holdBuild();
    const p = adapter.connectSession({ sessionId: 's1', tenantId: T }).catch((e: unknown) => e);
    await hold.started();
    await adapter.suspendSession('s1');
    await adapter.abortSession('s1');
    auth.discard.mockClear();
    hold.go();
    await p;
    expect(auth.discard).toHaveBeenCalledWith('s1');
    expect(auth.suspend).not.toHaveBeenCalled();
    expect(await adapter.resumeSession('s1')).toBe(false);
  });

  it('abertura automática cancelada não lança', async () => {
    const { adapter } = make(true);
    await adapter.connectSession({ sessionId: 's1', tenantId: T });
    await adapter.suspendSession('s1');
    const hold = holdBuild();
    const p = adapter.resumeSession('s1');
    await hold.started();
    await adapter.abortSession('s1');
    hold.go();
    expect(await p).toBe(false);
    expect(registry.has('s1')).toBe(false);
  });

  it('erro depois do acquire solta o lease', async () => {
    const { adapter, release } = make(true);
    auth.build.mockImplementationOnce(async () => { throw new Error('auth state down'); });
    await expect(adapter.connectSession({ sessionId: 's1', tenantId: T })).rejects.toThrow('auth state down');
    expect(release).toHaveBeenCalledWith('s1');
  });

  it('erro depois do acquire não solta o lease se outra abertura da sessão segue em curso', async () => {
    const { adapter, release } = make(true);
    const hold = holdBuild();
    const ok = adapter.connectSession({ sessionId: 's1', tenantId: T });
    await hold.started();
    auth.build.mockImplementationOnce(async () => { throw new Error('auth state down'); });
    await expect(adapter.connectSession({ sessionId: 's1', tenantId: T })).rejects.toThrow('auth state down');
    expect(release).not.toHaveBeenCalled();
    hold.go();
    await ok;
  });

  it('sem lease (acquire falso) não chama release', async () => {
    const { adapter, release } = make(false);
    await expect(adapter.connectSession({ sessionId: 's1', tenantId: T })).rejects.toBeInstanceOf(SessionLeaseHeldError);
    expect(release).not.toHaveBeenCalled();
  });
});
