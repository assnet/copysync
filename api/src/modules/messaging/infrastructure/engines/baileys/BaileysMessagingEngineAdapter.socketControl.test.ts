import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BaileysMessagingEngineAdapter } from './BaileysMessagingEngineAdapter';
import { BaileysSessionRegistry } from './BaileysSessionRegistry';
import { EngineTemporarilyUnavailableError } from '../../../../../shared/errors/internal/MessagingErrors';
import { SessionLeaseHeldError } from '../../../../../shared/errors/internal/SessionErrors';

// Socket falso (mesmo molde do teste de pareamento): guarda handlers para disparar connection.update
interface FakeSocket {
  handlers: Record<string, (u: unknown) => Promise<void>>;
  authState: { creds: { registered: boolean; me?: { id: string } } };
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
  build: vi.fn(async () => ({ state: { creds: {}, keys: {} }, saveCreds: async () => undefined })),
  release: vi.fn(async () => undefined),
  discard: vi.fn(async () => undefined),
  suspend: vi.fn(async () => undefined),
  flush: vi.fn(async () => undefined),
}));
vi.mock('./BaileysAuthStatePersistence', async (importOriginal) => ({
  isRegisteredCreds: (await importOriginal<typeof import('./BaileysAuthStatePersistence')>()).isRegisteredCreds,
  buildBaileysAuthState: () => auth.build(),
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

    expect(await adapter.resumeSession('s1')).toBe('resumed');
    expect(gate.acquire).toHaveBeenCalledWith('s1');
    expect(sockets).toHaveLength(2);
    expect(registry.get('s1')?.tenantId).toBe(T);
    expect(await adapter.resumeSession('s1')).toBe('gone'); // uma vez só
  });

  it('resumeSession com lease de outro processo devolve held sem abrir socket; a marca fica até forgetSuspension', async () => {
    const { adapter, gate } = make();
    await adapter.connectSession({ sessionId: 's1', tenantId: T });
    await adapter.suspendSession('s1');
    gate.acquire.mockResolvedValueOnce(false);

    expect(await adapter.resumeSession('s1')).toBe('held');
    expect(sockets).toHaveLength(1);
    expect(await adapter.forgetSuspension('s1')).toBe(T);
    expect(await adapter.forgetSuspension('s1')).toBeNull();
    expect(await adapter.resumeSession('s1')).toBe('gone');
    expect(gate.acquire).toHaveBeenCalledTimes(2);
  });

  it('acquire com erro de banco na retomada lança (não é held), mantém a suspensa e a próxima reabre', async () => {
    const gate = {
      acquire: vi.fn(async () => true),
      acquireResult: vi.fn(async (): Promise<'acquired' | 'held' | 'error'> => 'acquired'),
    };
    const { adapter, sessionRepo } = make(gate);
    await adapter.connectSession({ sessionId: 's1', tenantId: T });
    await adapter.suspendSession('s1');
    sessionRepo.updateStatus.mockClear();
    gate.acquireResult.mockResolvedValueOnce('error');

    await expect(adapter.resumeSession('s1')).rejects.toBeInstanceOf(EngineTemporarilyUnavailableError);
    expect(sockets).toHaveLength(1);
    expect(sessionRepo.updateStatus).not.toHaveBeenCalled();
    expect(await adapter.resumeSession('s1')).toBe('resumed');
    expect(sockets).toHaveLength(2);
  });

  it('acquire com erro de banco no connect do usuário dá 503 sem ser SessionLeaseHeldError', async () => {
    const { adapter } = make({ acquire: vi.fn(async () => true), acquireResult: vi.fn(async () => 'error' as const) } as never);
    const err = await adapter.connectSession({ sessionId: 's1', tenantId: T }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(EngineTemporarilyUnavailableError);
    expect(err).not.toBeInstanceOf(SessionLeaseHeldError);
    expect(sockets).toHaveLength(0);
  });

  it('resumeSession que falha ao reabrir mantém a suspensa e relança; a 2ª chamada reabre', async () => {
    const { adapter } = make();
    await adapter.connectSession({ sessionId: 's1', tenantId: T });
    await adapter.suspendSession('s1');
    version.fetch.mockRejectedValueOnce(new Error('rede'));

    await expect(adapter.resumeSession('s1')).rejects.toThrow('rede');
    expect(registry.has('s1')).toBe(false);
    expect(sockets).toHaveLength(1);

    expect(await adapter.resumeSession('s1')).toBe('resumed');
    expect(sockets).toHaveLength(2);
    expect(registry.get('s1')?.tenantId).toBe(T);
  });

  it('abort durante o resume que falha devolve gone e não devolve a sessão à suspensão', async () => {
    const { adapter } = make();
    await adapter.connectSession({ sessionId: 's1', tenantId: T });
    await adapter.suspendSession('s1');
    let fail!: (e: Error) => void;
    version.fetch.mockImplementationOnce(() => new Promise((_, rej) => { fail = rej; }));

    const p = adapter.resumeSession('s1');
    await vi.waitFor(() => expect(fail).toBeDefined());
    await adapter.abortSession('s1');
    fail(new Error('rede'));

    expect(await p).toBe('gone');
    expect(await adapter.resumeSession('s1')).toBe('gone');
    expect(sockets).toHaveLength(1);
  });

  it('abort, disconnect ou sessão nunca suspensa: resumeSession não reabre', async () => {
    const { adapter } = make();
    expect(await adapter.resumeSession('nada')).toBe('gone');
    await adapter.connectSession({ sessionId: 's1', tenantId: T });
    await adapter.suspendSession('s1');
    await adapter.abortSession('s1');
    expect(await adapter.resumeSession('s1')).toBe('gone');
    await adapter.connectSession({ sessionId: 's2', tenantId: T });
    await adapter.suspendSession('s2');
    await adapter.disconnectSession({ sessionId: 's2', tenantId: T });
    expect(await adapter.resumeSession('s2')).toBe('gone');
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

  it('listAuthenticatedSessionIds: só sockets com login concluído (QR sem leitura fica fora, T24)', async () => {
    const { adapter } = make();
    await adapter.connectSession({ sessionId: 's1', tenantId: T });
    await adapter.connectSession({ sessionId: 'qr', tenantId: T });
    sockets[1]!.authState.creds.registered = false;
    expect(adapter.listLocalSessionIds().sort()).toEqual(['qr', 's1']);
    expect(adapter.listAuthenticatedSessionIds()).toEqual(['s1']);
    sockets[1]!.authState.creds.me = { id: '5511999999999:1@s.whatsapp.net' }; // QR lido
    expect(adapter.listAuthenticatedSessionIds().sort()).toEqual(['qr', 's1']);
  });

  describe('prazo da abertura (F12)', () => {
    it('acquire pendurado na retomada: resume assenta no prazo (transitório) e o connect do usuário não espera além dele', async () => {
      vi.useFakeTimers();
      const gate = { acquire: vi.fn(async () => true) };
      const { adapter } = make(gate);
      await adapter.connectSession({ sessionId: 's1', tenantId: T });
      await adapter.suspendSession('s1');
      gate.acquire.mockImplementationOnce(() => new Promise<boolean>(() => undefined));
      const resume = adapter.resumeSession('s1').catch((e: unknown) => e);
      let connected = false;
      const user = adapter.connectSession({ sessionId: 's1', tenantId: T }).then(() => { connected = true; });
      await vi.advanceTimersByTimeAsync(9_999);
      expect(connected).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      await user;
      expect(connected).toBe(true);
      expect(await resume).toBe('gone'); // o connect do usuário apagou a suspensão
      expect(registry.has('s1')).toBe(true);
      expect(sockets).toHaveLength(2);
    });

    it('acquire pendurado na retomada sem connect do usuário: lança transitório e segue suspensa', async () => {
      vi.useFakeTimers();
      const gate = { acquire: vi.fn(async () => true) };
      const { adapter } = make(gate);
      await adapter.connectSession({ sessionId: 's1', tenantId: T });
      await adapter.suspendSession('s1');
      gate.acquire.mockImplementationOnce(() => new Promise<boolean>(() => undefined));
      const resume = adapter.resumeSession('s1').catch((e: unknown) => e);
      await vi.advanceTimersByTimeAsync(10_000);
      expect(await resume).toBeInstanceOf(EngineTemporarilyUnavailableError);
      expect(await adapter.resumeSession('s1')).toBe('resumed');
    });

    it('carga do auth state pendurada na retomada (auto): assenta no prazo com 503 e solta o lease', async () => {
      vi.useFakeTimers();
      const gate = { acquire: vi.fn(async () => true), release: vi.fn(async () => undefined) };
      const { adapter } = make(gate);
      await adapter.connectSession({ sessionId: 's1', tenantId: T });
      await adapter.suspendSession('s1');
      auth.build.mockImplementationOnce(() => new Promise(() => undefined));
      const p = adapter.resumeSession('s1').catch((e: unknown) => e);
      await vi.advanceTimersByTimeAsync(15_000);
      expect(await p).toBeInstanceOf(EngineTemporarilyUnavailableError);
      expect(gate.release).toHaveBeenCalledWith('s1');
      expect(registry.has('s1')).toBe(false);
      expect(adapter.listLocalSessionIds()).toEqual([]);
    });

    it('connect do usuário com carga do auth state > 15 s não dá 503 (prazo do usuário é 60 s)', async () => {
      vi.useFakeTimers();
      const gate = { acquire: vi.fn(async () => true), release: vi.fn(async () => undefined) };
      const { adapter } = make(gate);
      auth.build.mockImplementationOnce(() => new Promise((r) => {
        setTimeout(() => r({ state: { creds: {}, keys: {} }, saveCreds: async () => undefined }), 20_000);
      }));
      let outcome: unknown = 'pending';
      const p = adapter.connectSession({ sessionId: 's1', tenantId: T }).then(() => { outcome = 'ok'; }, (e: unknown) => { outcome = e; });
      await vi.advanceTimersByTimeAsync(15_000);
      expect(outcome).toBe('pending');
      await vi.advanceTimersByTimeAsync(5_000);
      await p;
      expect(outcome).toBe('ok');
      expect(registry.has('s1')).toBe(true);
      expect(gate.release).not.toHaveBeenCalled();
    });

    it('connect do usuário com carga do auth state pendurada: 503 em 60 s e solta o lease (F14)', async () => {
      vi.useFakeTimers();
      const gate = { acquire: vi.fn(async () => true), release: vi.fn(async () => undefined) };
      const { adapter } = make(gate);
      auth.build.mockImplementationOnce(() => new Promise(() => undefined));
      let outcome: unknown = 'pending';
      const p = adapter.connectSession({ sessionId: 's1', tenantId: T }).then(() => { outcome = 'ok'; }, (e: unknown) => { outcome = e; });
      await vi.advanceTimersByTimeAsync(59_000);
      expect(outcome).toBe('pending');
      await vi.advanceTimersByTimeAsync(1_000);
      await p;
      expect(outcome).toBeInstanceOf(EngineTemporarilyUnavailableError);
      expect(gate.release).toHaveBeenCalledWith('s1');
      expect(registry.has('s1')).toBe(false);
      expect(adapter.listLocalSessionIds()).toEqual([]);
    });

    it('abort onlyAuto (desistência) não cancela abertura do usuário em voo', async () => {
      const gate = { acquire: vi.fn(async () => true), release: vi.fn(async () => undefined) };
      const { adapter } = make(gate);
      let go!: () => void;
      auth.build.mockImplementationOnce(async () => {
        await new Promise<void>((r) => { go = r; });
        return { state: { creds: {}, keys: {} }, saveCreds: async () => undefined };
      });
      const user = adapter.connectSession({ sessionId: 's1', tenantId: T });
      await vi.waitFor(() => expect(go).toBeTypeOf('function'));
      await adapter.abortSession('s1', { onlyAuto: true });
      go();
      await expect(user).resolves.toBeDefined();
      expect(registry.has('s1')).toBe(true);
      expect(auth.discard).not.toHaveBeenCalled();
      expect(gate.release).not.toHaveBeenCalled();
    });

    it('abort onlyAuto sem abertura do usuário derruba a automática em voo', async () => {
      const gate = { acquire: vi.fn(async () => true), release: vi.fn(async () => undefined) };
      const { adapter } = make(gate);
      await adapter.connectSession({ sessionId: 's1', tenantId: T });
      await adapter.suspendSession('s1');
      let go!: () => void;
      auth.build.mockImplementationOnce(async () => {
        await new Promise<void>((r) => { go = r; });
        return { state: { creds: {}, keys: {} }, saveCreds: async () => undefined };
      });
      const resume = adapter.resumeSession('s1');
      await vi.waitFor(() => expect(go).toBeTypeOf('function'));
      await adapter.abortSession('s1', { onlyAuto: true });
      go();
      expect(await resume).toBe('gone');
      expect(registry.has('s1')).toBe(false);
      expect(gate.release).toHaveBeenCalledWith('s1');
    });

    it('abort com a abertura ainda no acquire: ela não registra socket depois e solta o lease tardio', async () => {
      const gate = { acquire: vi.fn(async () => true), release: vi.fn(async () => undefined) };
      const { adapter } = make(gate);
      await adapter.connectSession({ sessionId: 's1', tenantId: T });
      await adapter.suspendSession('s1');
      let free!: (v: boolean) => void;
      gate.acquire.mockImplementationOnce(() => new Promise<boolean>((r) => { free = r; }));
      const resume = adapter.resumeSession('s1');
      await vi.waitFor(() => expect(free).toBeTypeOf('function'));
      expect(await adapter.forgetSuspension('s1')).toBe(T);
      await adapter.abortSession('s1');
      free(true); // acquire tardio
      expect(await resume).toBe('gone');
      expect(registry.has('s1')).toBe(false);
      expect(sockets).toHaveLength(1);
      expect(adapter.listLocalSessionIds()).toEqual([]);
      expect(gate.release).toHaveBeenCalledExactlyOnceWith('s1'); // release condicionado ao dono
    });
  });
});
