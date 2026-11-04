import { describe, expect, it } from 'vitest';
import { Api } from 'telegram';
import bigInt from 'big-integer';
import { mediaType } from './TelegramMessagingEngineAdapter';

const doc = (mimeType: string, attributes: Api.TypeDocumentAttribute[] = []) => new Api.MessageMediaDocument({
  document: new Api.Document({
    id: bigInt(1), accessHash: bigInt(1), fileReference: Buffer.alloc(0), date: 0, mimeType, size: bigInt(10), dcId: 1, attributes,
  }),
});

describe('Telegram mediaType', () => {
  it('emite o mesmo enum do Baileys (captura compara com IMAGE)', () => {
    expect(mediaType(undefined)).toBe('TEXT');
    expect(mediaType(new Api.MessageMediaPhoto({}))).toBe('IMAGE');
    expect(mediaType(doc('video/mp4'))).toBe('VIDEO');
    expect(mediaType(doc('image/png'))).toBe('IMAGE');
    expect(mediaType(doc('audio/ogg', [new Api.DocumentAttributeAudio({ duration: 3, voice: true })]))).toBe('AUDIO');
    expect(mediaType(doc('image/webp', [new Api.DocumentAttributeSticker({ alt: '', stickerset: new Api.InputStickerSetEmpty() })]))).toBe('STICKER');
    expect(mediaType(doc('application/pdf'))).toBe('DOCUMENT');
  });
});
