import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BaileysMessagingEngineAdapter } from './BaileysMessagingEngineAdapter';
import { BaileysSessionRegistry } from './BaileysSessionRegistry';

// vi.mock sobe para antes dos imports. Socket falso: guarda os handlers para disparar connection.update à mão
const sockets: FakeSocket[] = [];
interface FakeSocket {
  handlers: Record<string, (u: unknown) => Promise<void>>;
  authState: { creds: { registered: boolean } };
  requestPairingCode: ReturnType<typeof vi.fn>;
  end: ReturnType<typeof vi.fn>;
  ev: { on: (e: string, h: (u: unknown) => Promise<void>) => void; removeAllListeners: () => void };
  ws: object;
}

vi.mock('@whiskeysockets/baileys', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    default: () => {
      const s: FakeSocket = {
        handlers: {},
        authState: { creds: { registered: false } },
        requestPairingCode: vi.fn(),
        end: vi.fn(),
        ev: { on: (e, h) => { s.handlers[e] = h; }, removeAllListeners: () => undefined },
        ws: {},
      };
      sockets.push(s);
      return s;
    },
    fetchLatestBaileysVersion: async () => ({ version: [2, 3000, 0] }),
    makeCacheableSignalKeyStore: (k: unknown) => k,
  };
});
vi.mock('./BaileysAuthStatePersistence', () => ({
  buildBaileysAuthState: async () => ({ state: { creds: {}, keys: {} }, saveCreds: async () => undefined }),
  flushAllAuthStates: async () => undefined,
}));
const disconnect = vi.hoisted(() => ({ value: { shouldReconnect: false, shouldClearCredentials: false, takenOverByAnotherInstance: false } }));
vi.mock('./BaileysErrorTranslator', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./BaileysErrorTranslator')>();
  return {
    ...actual,
    translateDisconnect: () => ({ ...disconnect.value, error: { code: 'X' } }),
  };
});


const S = 'sess-pair';
const T = 'tenant-1';
const PHONE = '5511999990000';

function make() {
  const statuses: string[] = [];
  const sessionRepo = { updateStatus: vi.fn(async (_s: string, _t: string, d: { status: string }) => { statuses.push(d.status); }), updatePhone: vi.fn() };
  const authStateRepo = { clearCredentials: vi.fn(async () => undefined) };
  const adapter = new BaileysMessagingEngineAdapter(
    sessionRepo as never, authStateRepo as never, {} as never, {} as never, {} as never,
  );
  const phones = (adapter as unknown as { pairingPhones: Map<string, string> }).pairingPhones;
  return { adapter, statuses, phones };
}

const last = () => sockets[sockets.length - 1]!;
const update = (u: unknown) => last().handlers['connection.update']!(u);

beforeEach(() => {
  BaileysSessionRegistry.get().delete(S);
  sockets.length = 0;
});

describe('BaileysMessagingEngineAdapter — código de pareamento', () => {
  it('pedido falhando no QR sai do modo código: rotação seguinte não repete', async () => {
    const { adapter, statuses, phones } = make();
    await adapter.requestPairingCode({ sessionId: S, tenantId: T, phone: PHONE });
    last().requestPairingCode.mockRejectedValue(new Error('rate'));
    await update({ qr: 'q1' });
    expect(phones.has(S)).toBe(false);
    expect(statuses).toContain('AWAITING_QR');
    await update({ qr: 'q2' });
    expect(last().requestPairingCode).toHaveBeenCalledTimes(1);
  });

  it('mesmo número com pedido em andamento reaproveita a promise', async () => {
    const { adapter } = make();
    await adapter.requestPairingCode({ sessionId: S, tenantId: T, phone: PHONE });
    let resolve!: (c: string) => void;
    last().requestPairingCode.mockReturnValue(new Promise<string>((r) => { resolve = r; }));
    BaileysSessionRegistry.get().setQr(S, 'q1');
    const a = adapter.requestPairingCode({ sessionId: S, tenantId: T, phone: PHONE });
    const b = adapter.requestPairingCode({ sessionId: S, tenantId: T, phone: PHONE });
    await update({ qr: 'q2' });
    resolve('ABCD1234');
    expect(await a).toEqual({ pairingCode: 'ABCD1234' });
    expect(await b).toEqual({ pairingCode: 'ABCD1234' });
    expect(last().requestPairingCode).toHaveBeenCalledTimes(1);
  });

  it('pedido direto (QR já emitido) falhando limpa o número', async () => {
    const { adapter, phones } = make();
    await adapter.requestPairingCode({ sessionId: S, tenantId: T, phone: PHONE });
    BaileysSessionRegistry.get().setQr(S, 'q1');
    last().requestPairingCode.mockRejectedValue(new Error('rate'));
    await expect(adapter.requestPairingCode({ sessionId: S, tenantId: T, phone: PHONE })).rejects.toBeDefined();
    expect(phones.has(S)).toBe(false);
  });

  it.each([
    ['FAILED sem reconexão', { shouldReconnect: false, shouldClearCredentials: false, takenOverByAnotherInstance: false }],
    ['credencial revogada', { shouldReconnect: false, shouldClearCredentials: true, takenOverByAnotherInstance: false }],
    ['assumida por outra instância', { shouldReconnect: false, shouldClearCredentials: false, takenOverByAnotherInstance: true }],
  ])('close terminal (%s) limpa o número', async (_n, info) => {
    const { adapter, phones } = make();
    await adapter.requestPairingCode({ sessionId: S, tenantId: T, phone: PHONE });
    disconnect.value = info;
    await update({ connection: 'close', lastDisconnect: { error: new Error('x') } });
    expect(phones.has(S)).toBe(false);
  });
});
