import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BaileysMessagingEngineAdapter } from './BaileysMessagingEngineAdapter';
import { BaileysSessionRegistry } from './BaileysSessionRegistry';
import { outboundEchoRegistries } from './outboundEchoRegistries';
import { sentMediaCache } from './sentMediaCache';

vi.mock('./BaileysAuthStatePersistence', () => ({
  buildBaileysAuthState: async () => ({ state: { creds: {}, keys: {} }, saveCreds: async () => undefined }),
  flushAllAuthStates: async () => undefined,
  releaseAuthState: async () => undefined,
  discardAuthState: async () => undefined,
}));

const S = 'sess-text';
const PREVIEW = { url: 'https://meli.la/abc', title: 'Fone', thumbnailJpeg: Buffer.from([0xff, 0xd8]) };

function make() {
  const order: string[] = [];
  const sendMessage = vi.fn(async (_jid: string, _content: unknown, opts?: { messageId?: string }) => {
    // O eco tem que estar marcado quando o envio sai.
    if (opts?.messageId && outboundEchoRegistries().media.consume(S, opts.messageId)) order.push('echo-registered');
    order.push('send');
    return { key: { id: opts?.messageId ?? 'LIB-ID' }, message: { extendedTextMessage: { text: 'x' } } };
  });
  const waUploadToServer = vi.fn();
  const socket = { sendMessage, waUploadToServer, user: { id: '5511999990000:1@s.whatsapp.net' }, ws: { isOpen: true } };
  BaileysSessionRegistry.get().set(S, { socket, tenantId: 't1' } as never);
  const adapter = new BaileysMessagingEngineAdapter({} as never, {} as never, {} as never, {} as never, {} as never);
  return { adapter, sendMessage, order, waUploadToServer };
}

beforeEach(() => BaileysSessionRegistry.get().delete(S));

describe('BaileysMessagingEngineAdapter.sendTextMessage', () => {
  it('sem prévia: linkPreview null explícito, id da lib, nada no cache', async () => {
    const { adapter, sendMessage } = make();
    const out = await adapter.sendTextMessage({ sessionId: S, tenantId: 't1', to: '5511888887777', body: 'oi https://x.y' });

    expect(sendMessage).toHaveBeenCalledWith('5511888887777@s.whatsapp.net', { text: 'oi https://x.y', linkPreview: null }, undefined);
    expect(out.messageId).toBe('LIB-ID');
    expect(sentMediaCache().get(S, 'LIB-ID')).toBeUndefined();
  });

  it('com prévia: id gerado no adapter, eco registrado antes do envio, conteúdo no cache', async () => {
    const { adapter, sendMessage, order, waUploadToServer } = make();
    const out = await adapter.sendTextMessage({
      sessionId: S, tenantId: 't1', to: '1203@g.us', body: 'Oferta https://meli.la/abc', linkPreview: PREVIEW,
    });

    const [jid, content, opts] = sendMessage.mock.calls[0]!;
    expect(jid).toBe('1203@g.us');
    expect(opts).toEqual({ messageId: out.messageId });
    expect(out.messageId).toMatch(/^[0-9A-F]+$/);
    expect(content).toMatchObject({
      text: 'Oferta https://meli.la/abc',
      linkPreview: { 'matched-text': 'https://meli.la/abc', title: 'Fone', jpegThumbnail: PREVIEW.thumbnailJpeg },
    });
    expect(waUploadToServer).not.toHaveBeenCalled(); // sem imageJpeg
    expect(order).toEqual(['echo-registered', 'send']);
    expect(sentMediaCache().get(S, out.messageId)).toEqual({ extendedTextMessage: { text: 'x' } });
  });

  it('com prévia e socket sem usuário: SESSION_NOT_CONNECTED sem enviar', async () => {
    const { adapter, sendMessage } = make();
    BaileysSessionRegistry.get().set(S, { socket: { sendMessage, ws: { isOpen: true } }, tenantId: 't1' } as never);
    await expect(adapter.sendTextMessage({ sessionId: S, tenantId: 't1', to: '1203@g.us', body: 'x', linkPreview: PREVIEW }))
      .rejects.toMatchObject({ code: 'SESSION_NOT_CONNECTED' });
    expect(sendMessage).not.toHaveBeenCalled();
  });
});
