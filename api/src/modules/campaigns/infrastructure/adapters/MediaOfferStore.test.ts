import { describe, it, expect, vi, beforeAll } from 'vitest';
import sharp from 'sharp';
import { MediaOfferStore } from './MediaOfferStore';
import { SharpImageTranscoder } from '../../../media/infrastructure/sharp/SharpImageTranscoder';
import { offerImageMimeFromUrl } from './offerImageTypes';
import type { IMediaFileStore } from '../../../media/domain/contracts/IMediaFileStore';
import type { BeginConsumeResult, IUploadSessionStore, UploadSessionRecord } from '../../../media/domain/contracts/IUploadSessionStore';

// JPEG real (o saveImage passa pelo sharp); gerado no beforeAll.
let JPEG: Buffer;
const PDF = Buffer.from('%PDF-1.4');

beforeAll(async () => {
  JPEG = await sharp({ create: { width: 10, height: 10, channels: 3, background: '#000' } }).jpeg().toBuffer();
});

function record(sizeBytes = 1024): UploadSessionRecord {
  return {
    uploadId: 'u1', tenantId: 't', userId: 'usr', purpose: 'media', fileName: 'a.jpg', declaredMimeType: 'image/jpeg',
    sizeBytes, chunkSizeBytes: 8, totalParts: 1, receivedParts: [0], state: 'CONSUMING',
    externalMessageId: null, messageId: null, createdAt: '', updatedAt: '',
  };
}

function setup(begin: BeginConsumeResult, content: Buffer = JPEG) {
  const saveBuffer = vi.fn(async (_b: Buffer, name: string) => `https://cdn/media/${name}`);
  const uploads = {
    beginConsume: vi.fn(async () => begin),
    readHead: vi.fn(async () => new Uint8Array(content)),
    binPath: vi.fn(() => '/tmp/u1.bin'),
    releaseConsume: vi.fn(async () => null),
    discard: vi.fn(async () => undefined),
  };
  const store = new MediaOfferStore({
    files: () => ({ saveBuffer } as unknown as IMediaFileStore),
    uploads: () => uploads as unknown as IUploadSessionStore,
    images: () => new SharpImageTranscoder(),
    readFile: async () => content,
  });
  return { store, saveBuffer, uploads };
}

const input = { tenantId: 't', userId: 'usr', uploadId: 'u1' };

describe('MediaOfferStore', () => {
  it('saveImage grava offer-<uuid>.jpg; tipo fora da lista → 415', async () => {
    const { store, saveBuffer } = setup({ outcome: 'not_found' });
    const url = await store.saveImage(JPEG, 'image/jpeg');
    expect(url).toMatch(/\/offer-[0-9a-f-]{36}\.jpg$/);
    expect(saveBuffer).toHaveBeenCalledOnce();
    await expect(store.saveImage(JPEG, 'image/gif')).rejects.toMatchObject({ code: 'UNSUPPORTED_MEDIA_TYPE' });
  });

  it('saveImage reduz PNG/WebP grande para JPEG com lado ≤ 600', async () => {
    const { store, saveBuffer } = setup({ outcome: 'not_found' });
    const png = await sharp({ create: { width: 2000, height: 1000, channels: 4, background: '#09f' } }).png().toBuffer();
    const webp = await sharp({ create: { width: 900, height: 1800, channels: 3, background: '#f90' } }).webp().toBuffer();
    expect(await store.saveImage(png, 'image/png')).toMatch(/\.jpg$/);
    expect(await store.saveImage(webp, 'image/webp')).toMatch(/\.jpg$/);
    const metas = await Promise.all(saveBuffer.mock.calls.map(([b]) => sharp(b).metadata()));
    expect(metas.map((m) => [m.format, m.width, m.height])).toEqual([['jpeg', 600, 300], ['jpeg', 300, 600]]);
  });

  it('saveImage: acima de 5 MB recusa antes do sharp; bytes inválidos → MEDIA_PROCESSING_FAILED', async () => {
    const resizeJpeg = vi.fn();
    const saveBuffer = vi.fn();
    const store = new MediaOfferStore({
      files: () => ({ saveBuffer } as unknown as IMediaFileStore),
      uploads: () => ({}) as IUploadSessionStore,
      images: () => ({ toJpeg: vi.fn(), resizeJpeg }),
    });
    await expect(store.saveImage(Buffer.alloc(5 * 1024 * 1024 + 1), 'image/jpeg')).rejects.toMatchObject({ code: 'MEDIA_TOO_LARGE' });
    expect(resizeJpeg).not.toHaveBeenCalled();

    const { store: real, saveBuffer: saved } = setup({ outcome: 'not_found' });
    await expect(real.saveImage(Buffer.from('lixo'), 'image/png')).rejects.toMatchObject({ code: 'MEDIA_PROCESSING_FAILED' });
    expect(saved).not.toHaveBeenCalled();
    expect(saveBuffer).not.toHaveBeenCalled();
  });

  it('upload de imagem: salva e descarta o upload', async () => {
    const { store, uploads } = setup({ outcome: 'started', record: record() });
    const url = await store.consumeUploadedImage(input);
    expect(url).toMatch(/\.jpg$/);
    expect(uploads.discard).toHaveBeenCalledWith('u1');
    expect(uploads.releaseConsume).not.toHaveBeenCalled();
  });

  it('não-imagem → 415 e devolve o upload', async () => {
    const { store, uploads, saveBuffer } = setup({ outcome: 'started', record: record(PDF.length) }, PDF);
    await expect(store.consumeUploadedImage(input)).rejects.toMatchObject({ code: 'UNSUPPORTED_MEDIA_TYPE' });
    expect(uploads.releaseConsume).toHaveBeenCalledWith('u1');
    expect(saveBuffer).not.toHaveBeenCalled();
  });

  it('acima de 5 MB → MEDIA_TOO_LARGE', async () => {
    const { store } = setup({ outcome: 'started', record: record(6 * 1024 * 1024) });
    await expect(store.consumeUploadedImage(input)).rejects.toMatchObject({ code: 'MEDIA_TOO_LARGE' });
  });

  it.each([
    [{ outcome: 'not_found' }, 'UPLOAD_NOT_FOUND'],
    [{ outcome: 'consumed', messageId: 'm', record: record() }, 'UPLOAD_NOT_FOUND'],
    [{ outcome: 'in_progress', record: record() }, 'UPLOAD_IN_PROGRESS'],
    [{ outcome: 'incomplete', record: record() }, 'UPLOAD_INCOMPLETE'],
  ] as [BeginConsumeResult, string][])('%o → %s', async (begin, code) => {
    const { store } = setup(begin);
    await expect(store.consumeUploadedImage(input)).rejects.toMatchObject({ code });
  });

  it('mime pela extensão da URL do store', () => {
    expect(offerImageMimeFromUrl('https://cdn/media/offer-1.png?x=1')).toBe('image/png');
    expect(offerImageMimeFromUrl('/media/offer-1.WEBP')).toBe('image/webp');
    expect(offerImageMimeFromUrl('/media/offer-1.jpeg')).toBe('image/jpeg');
    expect(offerImageMimeFromUrl('/media/offer-1')).toBe('image/jpeg');
  });

  it('removeImage: só foto de oferta; local por caminho, remoto pela URL; nunca lança', async () => {
    const remove = vi.fn(async () => undefined);
    const resolveLocalPath = vi.fn((u: string) => (u.startsWith('https://cdn/') ? '/data/media/x.jpg' : null));
    const store = new MediaOfferStore({
      files: () => ({ remove, resolveLocalPath } as unknown as IMediaFileStore),
      uploads: () => ({}) as IUploadSessionStore,
      images: () => new SharpImageTranscoder(),
    });
    const id = '0f8fad5b-d9cb-469f-a165-70867728950e';
    await store.removeImage(`https://cdn/media/offer-${id}.jpg`);
    await store.removeImage(`https://r2/bucket/offer-${id}.png`);
    await store.removeImage('https://cdn/media/outra-coisa.jpg');
    expect(remove.mock.calls).toEqual([['/data/media/x.jpg'], [`https://r2/bucket/offer-${id}.png`]]);
    remove.mockRejectedValueOnce(new Error('rm'));
    await expect(store.removeImage(`https://cdn/media/offer-${id}.jpg`)).resolves.toBeUndefined();
  });
});
