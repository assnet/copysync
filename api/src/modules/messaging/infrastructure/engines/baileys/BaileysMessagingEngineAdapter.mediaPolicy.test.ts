import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Socket falso (molde do teste de controle de socket): guarda os handlers para disparar messages.upsert
interface FakeSocket {
  handlers: Record<string, (u: unknown) => Promise<void>>;
  authState: { creds: { registered: boolean } };
  end: ReturnType<typeof vi.fn>;
  ev: { on: (e: string, h: (u: unknown) => Promise<void>) => void; removeAllListeners: ReturnType<typeof vi.fn> };
  ws: object;
  groupMetadata: () => Promise<{ subject: string; participants: unknown[] }>;
}
const h = vi.hoisted(() => ({
  sockets: [] as unknown[],
  download: vi.fn(async () => Buffer.from([1, 2, 3])),
  saveBuffer: vi.fn(async (_b: Buffer, name: string) => `/media/${name}`),
}));

vi.mock('@whiskeysockets/baileys', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    default: () => {
      const s: FakeSocket = {
        handlers: {},
        authState: { creds: { registered: true } },
        end: vi.fn(),
        ev: { on: (e, fn) => { s.handlers[e] = fn; }, removeAllListeners: vi.fn() },
        ws: {},
        groupMetadata: async () => ({ subject: 'Grupo', participants: [] }),
      };
      h.sockets.push(s);
      return s;
    },
    downloadMediaMessage: h.download,
    fetchLatestBaileysVersion: async () => ({ version: [2, 3000, 0] }),
    makeCacheableSignalKeyStore: (k: unknown) => k,
  };
});
vi.mock('./BaileysAuthStatePersistence', async (importOriginal) => ({
  isRegisteredCreds: (await importOriginal<typeof import('./BaileysAuthStatePersistence')>()).isRegisteredCreds,
  buildBaileysAuthState: async () => ({ state: { creds: {}, keys: {} }, saveCreds: async () => undefined }),
  flushAllAuthStates: async () => undefined,
  releaseAuthState: async () => undefined,
  discardAuthState: async () => undefined,
  suspendAuthState: async () => undefined,
}));
vi.mock('../../../../media/infrastructure/mediaContainer', () => ({
  mediaContainer: { mediaFileStore: { saveBuffer: h.saveBuffer, mediaExists: async () => false, publicUrl: (n: string) => `/media/${n}` } },
}));

import { BaileysMessagingEngineAdapter } from './BaileysMessagingEngineAdapter';
import { BaileysSessionRegistry } from './BaileysSessionRegistry';
import { outboundEchoRegistries } from './outboundEchoRegistries';
import { internalEventBus } from '../../../../../shared/events/InternalEventBus';
import type { IIncomingMediaPolicy } from '../../../domain/contracts/IIncomingMediaPolicy';

const S = 'sess-mp';
const T = 'tenant-mp';
const registry = BaileysSessionRegistry.get();
const IMG = { imageMessage: { mimetype: 'image/jpeg', caption: 'oferta https://loja.com/p' } };
const LP = {
  extendedTextMessage: {
    text: 'Olha https://loja.com/p', matchedText: 'https://loja.com/p', title: 'Produto',
    jpegThumbnail: new Uint8Array([0xff, 0xd8, 0xff, 1]),
  },
};

function denyPolicy() {
  return { shouldDownload: vi.fn(async () => false) } satisfies IIncomingMediaPolicy;
}

async function open(policy?: IIncomingMediaPolicy) {
  const conversations = { findActiveByGroupAndSession: vi.fn(async () => ({ autoDownloadMedia: true })) };
  const sessionRepo = { updateStatus: vi.fn(async () => undefined), updatePhone: vi.fn() };
  const adapter = new BaileysMessagingEngineAdapter(
    sessionRepo as never, {} as never, {} as never, conversations as never, {} as never, undefined, policy,
  );
  await adapter.connectSession({ sessionId: S, tenantId: T });
  const sock = h.sockets.at(-1) as FakeSocket;
  return { adapter, sock, conversations };
}

function received() {
  const events: Array<Record<string, unknown>> = [];
  internalEventBus.on('MESSAGE_RECEIVED', (e) => { events.push(e as unknown as Record<string, unknown>); });
  return events;
}

function msg(id: string, opts: { group?: boolean; fromMe?: boolean; message?: unknown; ageMs?: number } = {}) {
  return {
    key: {
      remoteJid: opts.group ? '1203@g.us' : '5511888887777@s.whatsapp.net',
      id,
      fromMe: opts.fromMe ?? false,
      ...(opts.group ? { participant: '5511777776666@s.whatsapp.net' } : {}),
    },
    messageTimestamp: Math.floor((Date.now() - (opts.ageMs ?? 0)) / 1000),
    message: opts.message ?? IMG,
  };
}

beforeEach(() => {
  for (const { sessionId } of registry.getAll()) registry.delete(sessionId);
  h.sockets.length = 0;
  vi.clearAllMocks();
});
afterEach(() => internalEventBus.removeAllListeners('MESSAGE_RECEIVED'));

describe('Baileys — política de mídia recebida e eco no notify (entrega D)', () => {
  it('sem política: regra atual (1:1 baixa)', async () => {
    const { sock } = await open();
    const events = received();
    await sock.handlers['messages.upsert']({ type: 'notify', messages: [msg('A1')] });
    expect(h.download).toHaveBeenCalledTimes(1);
    expect(events[0]?.mediaUrl).toBe(`/media/${S}_A1.jpg`);
  });

  it('notify: política recebe o contexto e a regra atual; negado não baixa e o evento segue sem mídia', async () => {
    const policy = denyPolicy();
    const { sock } = await open(policy);
    const events = received();
    await sock.handlers['messages.upsert']({ type: 'notify', messages: [msg('G1', { group: true })] });
    expect(policy.shouldDownload).toHaveBeenCalledWith(
      { tenantId: T, sessionId: S, isGroup: true, groupJid: '1203', msgType: 'IMAGE', fromMe: false },
      expect.any(Function),
    );
    expect(h.download).not.toHaveBeenCalled();
    expect(events).toHaveLength(1);
    expect(events[0]?.mediaUrl).toBeNull();
  });

  it('notify: política que adota a regra atual consulta autoDownloadMedia e baixa', async () => {
    const policy: IIncomingMediaPolicy = { shouldDownload: (_c, rule) => rule() };
    const { sock, conversations } = await open(policy);
    await sock.handlers['messages.upsert']({ type: 'notify', messages: [msg('G2', { group: true })] });
    expect(conversations.findActiveByGroupAndSession).toHaveBeenCalledWith('1203', S, T);
    expect(h.download).toHaveBeenCalledTimes(1);
  });

  it('notify: prévia negada não grava miniatura', async () => {
    const policy = denyPolicy();
    const { sock } = await open(policy);
    const events = received();
    await sock.handlers['messages.upsert']({ type: 'notify', messages: [msg('L1', { message: LP })] });
    expect(policy.shouldDownload).toHaveBeenCalledWith(expect.objectContaining({ msgType: 'LINK_PREVIEW' }), expect.any(Function));
    expect(h.saveBuffer).not.toHaveBeenCalled();
    expect(events[0]?.linkPreview).toMatchObject({ url: 'https://loja.com/p', thumbnailUrl: null });
  });

  it('notify: eco marcado é consumido antes do download e do bus', async () => {
    const { sock } = await open();
    const events = received();
    outboundEchoRegistries().media.register(S, 'ECHO1');
    await sock.handlers['messages.upsert']({ type: 'notify', messages: [msg('ECHO1', { fromMe: true })] });
    expect(h.download).not.toHaveBeenCalled();
    expect(events).toHaveLength(0);
    expect(outboundEchoRegistries().media.consume(S, 'ECHO1')).toBe(false);
  });

  it('notify: fromMe sem marca (enviada pelo celular) segue o caminho normal', async () => {
    const { sock } = await open();
    const events = received();
    await sock.handlers['messages.upsert']({ type: 'notify', messages: [msg('PH1', { fromMe: true })] });
    expect(events).toHaveLength(1);
  });

  it('append: política negada não baixa mídia recente nem miniatura', async () => {
    const policy = denyPolicy();
    const { adapter, sock } = await open(policy);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const items = await (adapter as any).mapMessagesToHistoryItems(
      [msg('AP1', { ageMs: 60_000 }), msg('AP2', { message: LP, ageMs: 60_000 })], sock, S, T,
    );
    expect(h.download).not.toHaveBeenCalled();
    expect(h.saveBuffer).not.toHaveBeenCalled();
    expect(items.map((i: { mediaUrl: unknown }) => i.mediaUrl)).toEqual([null, null]);
    expect(policy.shouldDownload).toHaveBeenCalledWith(expect.objectContaining({ msgType: 'IMAGE', isGroup: false }), expect.any(Function));
  });
});
