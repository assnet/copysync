import { describe, expect, it } from 'vitest';
import type { SendMediaMessageInput, SendTextMessageInput } from '../../domain/contracts/IMessagingEngine';
import { decodeEngineCall, decodeEngineValue, encodeEngineCall, encodeEngineValue } from './engineCallCodec';
import { engineCall } from './engineCallPlan';

describe('engineCallCodec', () => {
  it('ida e volta de sendTextMessage com OutboundLinkPreview (Buffer) e citação', () => {
    const input: SendTextMessageInput = {
      sessionId: 's1', tenantId: 't1', to: '5511999', body: 'veja https://x.y/p',
      mentions: ['5511888'], quotedMessage: null,
      linkPreview: {
        url: 'https://x.y/p', title: 'Produto', description: null,
        thumbnailJpeg: Buffer.from([0xff, 0xd8, 0x00, 0x01, 0xfe]),
        imageJpeg: Buffer.alloc(2048, 7),
      },
    };
    const back = decodeEngineCall(encodeEngineCall(engineCall('sendTextMessage', input)));
    expect(back.method).toBe('sendTextMessage');
    const arg = back.args[0] as SendTextMessageInput;
    expect(arg).toEqual(input);
    expect(Buffer.isBuffer(arg.linkPreview?.thumbnailJpeg)).toBe(true);
    expect(arg.linkPreview?.imageJpeg?.equals(input.linkPreview!.imageJpeg!)).toBe(true);
  });

  it('Date (sendReaction.reactedAt, updateChatState.lastMessage.timestamp) e Uint8Array (waveform)', () => {
    const reactedAt = new Date('2026-11-04T20:00:00.123Z');
    const r = decodeEngineCall(encodeEngineCall(engineCall('sendReaction', {
      sessionId: 's', tenantId: 't', emoji: null, reactedAt,
      target: { externalId: 'e', remoteJid: 'r', fromMe: true },
    })));
    const ra = (r.args[0] as { reactedAt: Date }).reactedAt;
    expect(ra).toBeInstanceOf(Date);
    expect(ra.getTime()).toBe(reactedAt.getTime());

    const waveform = new Uint8Array([0, 10, 255]);
    const media: SendMediaMessageInput = {
      sessionId: 's', tenantId: 't', to: '1', messageId: 'm',
      media: { kind: 'voice', filePath: '/x.ogg', mimeType: 'audio/ogg', sizeBytes: 3, waveform },
    };
    const m = decodeEngineCall(encodeEngineCall(engineCall('sendMediaMessage', media)));
    const w = (m.args[0] as SendMediaMessageInput).media.waveform!;
    expect(w).toBeInstanceOf(Uint8Array);
    expect(Buffer.isBuffer(w)).toBe(false);
    expect([...w]).toEqual([0, 10, 255]);
  });

  it('resultados: void, null, Date em SendMessageResult, listas', () => {
    expect(decodeEngineValue(encodeEngineValue(undefined))).toBeUndefined();
    expect(decodeEngineValue(encodeEngineValue(null))).toBeNull();
    const sent = { messageId: 'm1', sentAt: new Date('2026-01-01T00:00:00Z') };
    expect(decodeEngineValue(encodeEngineValue(sent))).toEqual(sent);
    expect(decodeEngineValue(encodeEngineValue([1, undefined, 'a']))).toEqual([1, undefined, 'a']);
    expect(decodeEngineValue(encodeEngineValue({ a: undefined, b: 1 }))).toEqual({ b: 1 });
  });

  it('rejeita chamada inválida, chave reservada e tipos não serializáveis', () => {
    expect(() => decodeEngineCall(JSON.stringify({ method: 'closeAllSockets', args: [] }))).toThrow(TypeError);
    expect(() => decodeEngineCall(JSON.stringify({ method: 'getSessionQr', args: 's' }))).toThrow(TypeError);
    expect(() => decodeEngineCall('null')).toThrow(TypeError);
    expect(() => encodeEngineValue({ $wire: 'buf' })).toThrow(TypeError);
    expect(() => encodeEngineValue({ n: 1n })).toThrow(TypeError);
    expect(() => encodeEngineValue(new Date(NaN))).toThrow(TypeError);
    expect(() => decodeEngineValue(JSON.stringify({ $wire: 'x' }))).toThrow(TypeError);
  });
});
