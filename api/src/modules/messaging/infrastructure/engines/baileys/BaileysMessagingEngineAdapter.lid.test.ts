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
import { internalEventBus } from '../../../../../shared/events/InternalEventBus';

const S = 'sess-lid';
const T = 'tenant-lid';
const registry = BaileysSessionRegistry.get();
const PHONE = '5511777776666';

type Sock = FakeSocket & { signalRepository?: unknown; user?: unknown };

async function open(knownPhone: string | null, knownLid: string | null = null) {
  const contacts = {
    findByLid: vi.fn(async () => (knownPhone ? { phone: knownPhone } : null)),
    findByPhone: vi.fn(async () => (knownLid ? { lid: knownLid } : null)),
  };
  const conversations = { findActiveByGroupAndSession: vi.fn(async () => ({ autoDownloadMedia: false })) };
  const sessionRepo = { updateStatus: vi.fn(async () => undefined), updatePhone: vi.fn() };
  const adapter = new BaileysMessagingEngineAdapter(
    sessionRepo as never, {} as never, contacts as never, conversations as never, {} as never,
  );
  await adapter.connectSession({ sessionId: S, tenantId: T });
  const sock = h.sockets.at(-1) as Sock;
  const lidMapping = {
    getPNForLID: vi.fn(async () => `${PHONE}@s.whatsapp.net`),
    getLIDForPN: vi.fn(async () => '999@lid'),
  };
  sock.signalRepository = { lidMapping };
  return { adapter, sock, contacts, lidMapping };
}

function received() {
  const events: Array<Record<string, unknown>> = [];
  internalEventBus.on('MESSAGE_RECEIVED', (e) => { events.push(e as unknown as Record<string, unknown>); });
  return events;
}

const TEXT = { conversation: 'oi' };
const MENTION = { extendedTextMessage: { text: 'oi @777', contextInfo: { mentionedJid: ['777@lid'] } } };

beforeEach(() => {
  for (const { sessionId } of registry.getAll()) registry.delete(sessionId);
  h.sockets.length = 0;
  vi.clearAllMocks();
});
afterEach(() => internalEventBus.removeAllListeners('MESSAGE_RECEIVED'));

describe('Baileys — LID do autor (MQ-19)', () => {
  it('1:1 @lid resolvido por remoteJidAlt: from = telefone, authorLid = LID', async () => {
    const { sock } = await open(null);
    const events = received();
    await sock.handlers['messages.upsert']({ type: 'notify', messages: [{
      key: { remoteJid: '777@lid', remoteJidAlt: `${PHONE}@s.whatsapp.net`, id: 'L1', fromMe: false },
      message: TEXT,
    }] });
    expect(events[0]).toMatchObject({ from: PHONE, authorLid: '777' });
  });

  it('1:1 por telefone sem LID: evento sem authorLid', async () => {
    const { sock } = await open(null);
    const events = received();
    await sock.handlers['messages.upsert']({ type: 'notify', messages: [{
      key: { remoteJid: `${PHONE}@s.whatsapp.net`, id: 'L2', fromMe: false }, message: TEXT,
    }] });
    expect(events[0]).not.toHaveProperty('authorLid');
  });

  it('grupo com participant @lid: propaga authorLid no evento', async () => {
    const { sock } = await open(null);
    const events = received();
    await sock.handlers['messages.upsert']({ type: 'notify', messages: [{
      key: { remoteJid: '1203@g.us', participant: '777@lid', participantAlt: `${PHONE}@s.whatsapp.net`, id: 'L3', fromMe: false },
      message: TEXT,
    }] });
    expect(events[0]).toMatchObject({ isGroup: true, participant: PHONE, authorLid: '777' });
  });

  it('menção com LID persistido: resolve sem chamar a engine', async () => {
    const { sock, contacts, lidMapping } = await open('5511000001111');
    const events = received();
    await sock.handlers['messages.upsert']({ type: 'notify', messages: [{
      key: { remoteJid: `${PHONE}@s.whatsapp.net`, id: 'M1', fromMe: false }, message: MENTION,
    }] });
    expect(contacts.findByLid).toHaveBeenCalledWith(T, '777');
    expect(lidMapping.getPNForLID).not.toHaveBeenCalled();
    expect(events[0]?.body).toBe('oi @5511000001111');
  });

  it('menção com miss no banco: cai na engine', async () => {
    const { sock, lidMapping } = await open(null);
    const events = received();
    await sock.handlers['messages.upsert']({ type: 'notify', messages: [{
      key: { remoteJid: `${PHONE}@s.whatsapp.net`, id: 'M2', fromMe: false }, message: MENTION,
    }] });
    expect(lidMapping.getPNForLID).toHaveBeenCalledWith('777');
    expect(events[0]?.body).toBe(`oi @${PHONE}`);
  });

  it('menção com falha no banco: cai na engine sem derrubar a mensagem', async () => {
    const { sock, contacts, lidMapping } = await open(null);
    contacts.findByLid.mockRejectedValueOnce(new Error('db down'));
    const events = received();
    await sock.handlers['messages.upsert']({ type: 'notify', messages: [{
      key: { remoteJid: `${PHONE}@s.whatsapp.net`, id: 'M3', fromMe: false }, message: MENTION,
    }] });
    expect(lidMapping.getPNForLID).toHaveBeenCalled();
    expect(events).toHaveLength(1);
  });

  it('autor citado com LID persistido: não pede à engine', async () => {
    const { adapter, sock, contacts, lidMapping } = await open(null, '888');
    const ref = { externalId: 'Q1', remoteJid: '1203@g.us', fromMe: false, body: 'x', type: 'TEXT', participant: PHONE };
    const out = await (adapter as unknown as {
      resolveQuoteAuthor: (...a: unknown[]) => Promise<string | null>;
    }).resolveQuoteAuthor(sock, T, ref, '1203@g.us', S);
    expect(contacts.findByPhone).toHaveBeenCalledWith(PHONE, T);
    expect(lidMapping.getLIDForPN).not.toHaveBeenCalled();
    expect(out).toBe('888@lid');
  });

  it('autor citado com miss: caminho atual pela engine', async () => {
    const { adapter, sock, lidMapping } = await open(null, null);
    const ref = { externalId: 'Q2', remoteJid: '1203@g.us', fromMe: false, body: 'x', type: 'TEXT', participant: PHONE };
    const out = await (adapter as unknown as {
      resolveQuoteAuthor: (...a: unknown[]) => Promise<string | null>;
    }).resolveQuoteAuthor(sock, T, ref, '1203@g.us', S);
    expect(lidMapping.getLIDForPN).toHaveBeenCalledWith(`${PHONE}@s.whatsapp.net`);
    expect(out).toBe('999@lid');
  });
});
