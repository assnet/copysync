import { beforeAll, describe, it, expect, vi } from 'vitest';
import sharp from 'sharp';
import type { WAMediaUploadFunction } from '@whiskeysockets/baileys';
import { buildBaileysLinkPreview } from './buildBaileysLinkPreview';
import type { OutboundLinkPreview } from '../../../domain/contracts/IMessagingEngine';

let IMAGEM: Buffer;
const MINI = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);

beforeAll(async () => {
  IMAGEM = await sharp({ create: { width: 600, height: 300, channels: 3, background: '#09f' } }).jpeg().toBuffer();
});

const preview = (over: Partial<OutboundLinkPreview> = {}): OutboundLinkPreview => ({
  url: 'https://meli.la/abc',
  title: 'Fone sem fio',
  description: 'R$ 99',
  thumbnailJpeg: MINI,
  imageJpeg: IMAGEM,
  ...over,
});

const okUpload = () =>
  vi.fn<WAMediaUploadFunction>(async () => ({ mediaUrl: 'https://mmg/x', directPath: '/v/t62/x' }));

describe('buildBaileysLinkPreview', () => {
  it('upload ok: cartão grande como thumbnail-link, com tempo limite e miniatura pequena nossa', async () => {
    const upload = okUpload();
    const info = await buildBaileysLinkPreview(preview(), { upload, uploadTimeoutMs: 1234 });

    expect(upload).toHaveBeenCalledOnce();
    expect(upload.mock.calls[0]![1]).toMatchObject({ timeoutMs: 1234 });
    expect(info).toMatchObject({ 'matched-text': 'https://meli.la/abc', title: 'Fone sem fio', description: 'R$ 99' });
    expect(info.jpegThumbnail).toBe(MINI);
    const hq = info.highQualityThumbnail!;
    expect(hq.directPath).toBe('/v/t62/x');
    expect(hq.mediaKey?.length).toBeGreaterThan(0);
    expect(hq.fileSha256?.length).toBeGreaterThan(0);
    expect(hq.fileEncSha256?.length).toBeGreaterThan(0);
    expect([hq.width, hq.height]).toEqual([600, 300]);
  });

  it.each([
    ['falha', new Error('upload failed')],
    ['timeout', Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' })],
  ])('upload %s: segue só com a miniatura pequena e avisa', async (_caso, erro) => {
    const upload = vi.fn<WAMediaUploadFunction>(async () => { throw erro; });
    const onUploadFailed = vi.fn();
    const info = await buildBaileysLinkPreview(preview(), { upload, uploadTimeoutMs: 10, onUploadFailed });

    expect(info.highQualityThumbnail).toBeUndefined();
    expect(info.jpegThumbnail).toBe(MINI);
    expect(info.title).toBe('Fone sem fio');
    expect(onUploadFailed).toHaveBeenCalledWith(erro);
  });

  it('sem imagem grande não sobe nada; campos vazios ficam fora', async () => {
    const upload = okUpload();
    const info = await buildBaileysLinkPreview(
      preview({ imageJpeg: null, thumbnailJpeg: null, description: null }),
      { upload, uploadTimeoutMs: 10 },
    );
    expect(upload).not.toHaveBeenCalled();
    expect(info).toStrictEqual({ 'canonical-url': 'https://meli.la/abc', 'matched-text': 'https://meli.la/abc', title: 'Fone sem fio' });
  });
});
