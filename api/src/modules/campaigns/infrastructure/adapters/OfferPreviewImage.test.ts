import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import sharp from 'sharp';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OfferPreviewImage } from './OfferPreviewImage';
import { SharpImageTranscoder } from '../../../media/infrastructure/sharp/SharpImageTranscoder';
import type { IMediaFileStore } from '../../../media/domain/contracts/IMediaFileStore';
import type { IImageTranscoder } from '../../../media/domain/contracts/IImageTranscoder';

let dir: string;
let photo: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'offer-preview-'));
  photo = join(dir, 'offer-1.jpg');
  await writeFile(photo, await sharp({ create: { width: 1200, height: 800, channels: 3, background: '#c00' } }).jpeg().toBuffer());
});
afterAll(async () => { await rm(dir, { recursive: true, force: true }); });

function setup(filePath: string | null, images: IImageTranscoder = new SharpImageTranscoder()) {
  const release = vi.fn(async () => undefined);
  const acquireLocalFile = vi.fn(async () => (filePath ? { filePath, sizeBytes: 1, release } : null));
  const preview = new OfferPreviewImage({
    files: () => ({ acquireLocalFile } as unknown as IMediaFileStore),
    images: () => images,
  });
  return { preview, release, acquireLocalFile };
}

describe('OfferPreviewImage', () => {
  it('gera JPEG ≤ 600 e miniatura ≤ 192 e libera o arquivo', async () => {
    const { preview, release, acquireLocalFile } = setup(photo);
    const out = await preview.build('https://cdn/media/offer-1.jpg');
    expect(acquireLocalFile).toHaveBeenCalledWith('https://cdn/media/offer-1.jpg');
    const big = await sharp(out!.imageJpeg).metadata();
    const small = await sharp(out!.thumbnailJpeg).metadata();
    expect([big.format, big.width, big.height]).toEqual(['jpeg', 600, 400]);
    expect([small.format, small.width, small.height]).toEqual(['jpeg', 192, 128]);
    expect(release).toHaveBeenCalledOnce();
  });

  it('arquivo fora do store ou sumido: null', async () => {
    const { preview } = setup(null);
    await expect(preview.build('https://outro/x.jpg')).resolves.toBeNull();
  });

  it('erro na redução: null e libera o arquivo', async () => {
    const images = { resizeJpeg: vi.fn().mockRejectedValue(new Error('bad')) } as unknown as IImageTranscoder;
    const { preview, release } = setup(photo, images);
    await expect(preview.build('https://cdn/media/offer-1.jpg')).resolves.toBeNull();
    expect(release).toHaveBeenCalledOnce();
  });
});
