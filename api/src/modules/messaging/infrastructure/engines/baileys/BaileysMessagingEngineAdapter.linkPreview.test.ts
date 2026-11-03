import { describe, it, expect, vi, beforeEach } from 'vitest';

const { saveBuffer, downloadHq } = vi.hoisted(() => ({
  saveBuffer: vi.fn(async (_buf: Buffer, name: string) => `/media/${name}`),
  downloadHq: vi.fn(async () => Buffer.from([0xff, 0xd8, 0xff, 9])),
}));

vi.mock('./BaileysAuthStatePersistence', () => ({
  buildBaileysAuthState: async () => ({ state: { creds: {}, keys: {} }, saveCreds: async () => undefined }),
  flushAllAuthStates: async () => undefined,
  releaseAuthState: async () => undefined,
  discardAuthState: async () => undefined,
}));
vi.mock('../../../../media/infrastructure/mediaContainer', () => ({
  mediaContainer: { mediaFileStore: { saveBuffer, mediaExists: async () => false, publicUrl: (n: string) => `/media/${n}` } },
}));
vi.mock('./downloadLinkPreviewThumb', () => ({ downloadLinkPreviewThumb: downloadHq }));

import { BaileysMessagingEngineAdapter, extractBaileysMessage } from './BaileysMessagingEngineAdapter';

const S = 'sess-lp';
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 1]);
const ext = {
  text: 'Olha https://loja.com/p',
  matchedText: 'https://loja.com/p',
  title: 'Produto',
  description: 'Desc',
  jpegThumbnail: JPEG,
  thumbnailDirectPath: '/v/t62/x',
  mediaKey: new Uint8Array([7]),
};

function historyMsg(id: string, ageMs: number) {
  return {
    key: { remoteJid: '5511888887777@s.whatsapp.net', id, fromMe: false },
    messageTimestamp: Math.floor((Date.now() - ageMs) / 1000),
    message: { extendedTextMessage: ext },
  };
}

function mapHistory(msgs: unknown[]) {
  const adapter = new BaileysMessagingEngineAdapter({} as never, {} as never, {} as never, {} as never, {} as never);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (adapter as any).mapMessagesToHistoryItems(msgs, {}, S, 't1');
}

beforeEach(() => {
  saveBuffer.mockClear();
  downloadHq.mockClear();
});

describe('extractBaileysMessage — prévia de link', () => {
  it('extendedText com prévia traz linkPreview validado', () => {
    const out = extractBaileysMessage({ extendedTextMessage: ext });
    expect(out?.linkPreview).toMatchObject({ url: 'https://loja.com/p', title: 'Produto', description: 'Desc' });
    expect(out?.linkPreview?.inlineThumb?.length).toBe(4);
    expect(out?.linkPreview?.hq?.directPath).toBe('/v/t62/x');
  });

  it('extendedText sem matchedText e conversation simples: sem prévia', () => {
    expect(extractBaileysMessage({ extendedTextMessage: { text: 'oi', title: 'X' } })?.linkPreview).toBeNull();
    expect(extractBaileysMessage({ conversation: 'https://loja.com/p' })?.linkPreview).toBeUndefined();
  });
});

describe('mapMessagesToHistoryItems — prévia de link', () => {
  it('mais de 30 min: grava só os textos, sem arquivo nem download', async () => {
    const [item] = await mapHistory([historyMsg('OLD', 31 * 60_000)]);
    expect(item.linkPreview).toEqual({ url: 'https://loja.com/p', title: 'Produto', description: 'Desc', thumbnailUrl: null });
    expect(saveBuffer).not.toHaveBeenCalled();
    expect(downloadHq).not.toHaveBeenCalled();
  });

  it('recente de contato: pequena e grande no mesmo arquivo', async () => {
    const [item] = await mapHistory([historyMsg('NEW', 60_000)]);
    expect(saveBuffer.mock.calls.map((c) => c[1])).toEqual([`${S}_NEW_lp.jpg`, `${S}_NEW_lp.jpg`]);
    expect(downloadHq).toHaveBeenCalledTimes(1);
    expect(item.linkPreview.thumbnailUrl).toBe(`/media/${S}_NEW_lp.jpg`);
  });

  it('texto sem link: linkPreview null', async () => {
    const [item] = await mapHistory([{
      key: { remoteJid: '5511888887777@s.whatsapp.net', id: 'TXT', fromMe: false },
      messageTimestamp: Math.floor(Date.now() / 1000),
      message: { conversation: 'oi' },
    }]);
    expect(item.linkPreview).toBeNull();
  });
});
