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
const version = vi.hoisted(() => ({ fetch: vi.fn(async () => ({ version: [2, 3000, 0] })) }));

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
    fetchLatestBaileysVersion: () => version.fetch(),
    makeCacheableSignalKeyStore: (k: unknown) => k,
  };
});
const auth = vi.hoisted(() => ({
  release: vi.fn(async () => undefined),
  discard: vi.fn(async () => undefined),
  suspend: vi.fn(async () => undefined),
  flush: vi.fn(async () => undefined),
}));
vi.mock('./BaileysAuthStatePersistence', () => ({
  buildBaileysAuthState: async () => ({ state: { creds: {}, keys: {} }, saveCreds: async () => undefined }),
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

function make(gate = { acquire: vi.fn(async () => true) }) {
  const sessionRepo = { updateStatus: vi.fn(async () => undefined), updatePhone: vi.fn() };
  const adapter = new BaileysMessagingEngineAdapter(
    sessionRepo as never, { clearCredentials: vi.fn() } as never, {} as never, {} as never, {} as never, gate,
  );
  return { adapter, sessionRepo, gate };
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

  it('suspendSession fecha o socket preservando as chaves (suspend, não discard) sem gravar status', async () => {
    const { adapter, sessionRepo } = make();
    await adapter.connectSession({ sessionId: 's1', tenantId: T });
    sessionRepo.updateStatus.mockClear();
    const sock = sockets[0]!;

    await adapter.suspendSession('s1');

    expect(sock.end).toHaveBeenCalledTimes(1);
    expect(registry.has('s1')).toBe(false);
    expect(auth.suspend).toHaveBeenCalledWith('s1');
    expect(auth.discard).not.toHaveBeenCalled();
    expect(auth.release).not.toHaveBeenCalled();
    expect(sessionRepo.updateStatus).not.toHaveBeenCalled();
  });

  it('resumeSession reabre a suspensa pela origem auto (lease → socket novo)', async () => {
    const { adapter, gate } = make();
    await adapter.connectSession({ sessionId: 's1', tenantId: T });
    await adapter.suspendSession('s1');
    gate.acquire.mockClear();

    expect(await adapter.resumeSession('s1')).toBe(true);
    expect(gate.acquire).toHaveBeenCalledWith('s1');
    expect(sockets).toHaveLength(2);
    expect(registry.get('s1')?.tenantId).toBe(T);
    expect(await adapter.resumeSession('s1')).toBe(false); // uma vez só
  });

  it('resumeSession com lease de outro processo devolve false sem lançar nem abrir socket', async () => {
    const { adapter, gate } = make();
    await adapter.connectSession({ sessionId: 's1', tenantId: T });
    await adapter.suspendSession('s1');
    gate.acquire.mockResolvedValueOnce(false);

    expect(await adapter.resumeSession('s1')).toBe(false);
    expect(sockets).toHaveLength(1);
    expect(await adapter.resumeSession('s1')).toBe(false); // lease de outro dono limpa a marca
    expect(gate.acquire).toHaveBeenCalledTimes(2);
  });

  it('resumeSession que falha ao reabrir mantém a suspensa e relança; a 2ª chamada reabre', async () => {
    const { adapter } = make();
    await adapter.connectSession({ sessionId: 's1', tenantId: T });
    await adapter.suspendSession('s1');
    version.fetch.mockRejectedValueOnce(new Error('rede'));

    await expect(adapter.resumeSession('s1')).rejects.toThrow('rede');
    expect(registry.has('s1')).toBe(false);
    expect(sockets).toHaveLength(1);

    expect(await adapter.resumeSession('s1')).toBe(true);
    expect(sockets).toHaveLength(2);
    expect(registry.get('s1')?.tenantId).toBe(T);
  });

  it('abort durante o resume que falha não devolve a sessão à suspensão', async () => {
    const { adapter } = make();
    await adapter.connectSession({ sessionId: 's1', tenantId: T });
    await adapter.suspendSession('s1');
    let fail!: (e: Error) => void;
    version.fetch.mockImplementationOnce(() => new Promise((_, rej) => { fail = rej; }));

    const p = adapter.resumeSession('s1');
    await vi.waitFor(() => expect(fail).toBeDefined());
    await adapter.abortSession('s1');
    fail(new Error('rede'));

    await expect(p).rejects.toThrow('rede');
    expect(await adapter.resumeSession('s1')).toBe(false);
    expect(sockets).toHaveLength(1);
  });

  it('abort, disconnect ou sessão nunca suspensa: resumeSession não reabre', async () => {
    const { adapter } = make();
    expect(await adapter.resumeSession('nada')).toBe(false);
    await adapter.connectSession({ sessionId: 's1', tenantId: T });
    await adapter.suspendSession('s1');
    await adapter.abortSession('s1');
    expect(await adapter.resumeSession('s1')).toBe(false);
    await adapter.connectSession({ sessionId: 's2', tenantId: T });
    await adapter.suspendSession('s2');
    await adapter.disconnectSession({ sessionId: 's2', tenantId: T });
    expect(await adapter.resumeSession('s2')).toBe(false);
    expect(sockets).toHaveLength(2);
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
