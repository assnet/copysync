import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import sharp from 'sharp';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OfferPreviewImage } from './OfferPreviewImage';
import { SharpOfferWatermarkCompositor } from './SharpOfferWatermarkCompositor';
import { TenantOfferImageDecorator } from '../../application/services/TenantOfferImageDecorator';
import { SharpImageTranscoder } from '../../../media/infrastructure/sharp/SharpImageTranscoder';
import type { IMediaFileStore } from '../../../media/domain/contracts/IMediaFileStore';
import type { IImageTranscoder } from '../../../media/domain/contracts/IImageTranscoder';
import type { IOfferImageDecorator } from '../../domain/contracts/IOfferImageDecorator';
import type { OfferWatermark } from '../../domain/entities/OfferWatermark';

let dir: string;
let photo: string;
const sources: Record<'jpeg' | 'png' | 'webp', string> = { jpeg: '', png: '', webp: '' };
const GRAY = { r: 128, g: 128, b: 128 };

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'offer-preview-'));
  photo = join(dir, 'offer-1.jpg');
  await writeFile(photo, await sharp({ create: { width: 1200, height: 800, channels: 3, background: '#c00' } }).jpeg().toBuffer());
  for (const fmt of ['jpeg', 'png', 'webp'] as const) {
    sources[fmt] = join(dir, `src.${fmt}`);
    const img = sharp({ create: { width: 1200, height: 800, channels: 3, background: GRAY } });
    await writeFile(sources[fmt], await (fmt === 'jpeg' ? img.jpeg() : fmt === 'png' ? img.png() : img.webp()).toBuffer());
  }
});
afterAll(async () => { await rm(dir, { recursive: true, force: true }); });

function setup(filePath: string | null, images: IImageTranscoder = new SharpImageTranscoder(), decorator?: IOfferImageDecorator) {
  const release = vi.fn(async () => undefined);
  const acquireLocalFile = vi.fn(async () => (filePath ? { filePath, sizeBytes: 1, release } : null));
  const preview = new OfferPreviewImage({
    files: () => ({ acquireLocalFile } as unknown as IMediaFileStore),
    images: () => images,
    ...(decorator ? { decorator: () => decorator } : {}),
  });
  return { preview, release, acquireLocalFile };
}

/** Decorador real (compositor sharp) com plano, registro e logo em memória. */
async function realDecorator(over: { plan?: boolean | null; record?: Partial<OfferWatermark> | null; logo?: Buffer | null | Error } = {}) {
  const logo = over.logo !== undefined ? over.logo
    : await sharp({ create: { width: 200, height: 200, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 1 } } }).png().toBuffer();
  const record: OfferWatermark | null = over.record === null ? null : {
    id: 'w', tenantId: 't1', kind: 'IMAGE', imageKey: 'offer-watermark-x.png', text: 'Loja', enabled: true,
    position: 'TOP_LEFT', size: 'LARGE', opacity: 100, createdAt: new Date(), updatedAt: new Date(), ...over.record,
  };
  return new TenantOfferImageDecorator({
    entitlements: { getBoolean: async () => (over.plan === undefined ? true : over.plan) },
    watermarks: { findByTenant: async () => record },
    logos: { read: async () => { if (logo instanceof Error) throw logo; return logo; } },
    compositor: new SharpOfferWatermarkCompositor(),
  });
}

async function pixel(buf: Buffer, x: number, y: number) {
  const { data, info } = await sharp(buf).raw().toBuffer({ resolveWithObject: true });
  const i = (y * info.width + x) * info.channels;
  return { r: data[i]!, g: data[i + 1]!, b: data[i + 2]! };
}

/** O que o envio gerava antes da marca: redução direto do caminho. */
async function today(filePath: string) {
  const t = new SharpImageTranscoder();
  return { imageJpeg: (await t.resizeJpeg(filePath, 600, 75)).buffer, thumbnailJpeg: (await t.resizeJpeg(filePath, 192, 70)).buffer };
}

describe('OfferPreviewImage', () => {
  it('gera JPEG ≤ 600 e miniatura ≤ 192 e libera o arquivo', async () => {
    const { preview, release, acquireLocalFile } = setup(photo);
    const out = await preview.build('t1', 'https://cdn/media/offer-1.jpg');
    expect(acquireLocalFile).toHaveBeenCalledWith('https://cdn/media/offer-1.jpg');
    const big = await sharp(out!.imageJpeg).metadata();
    const small = await sharp(out!.thumbnailJpeg).metadata();
    expect([big.format, big.width, big.height]).toEqual(['jpeg', 600, 400]);
    expect([small.format, small.width, small.height]).toEqual(['jpeg', 192, 128]);
    expect(release).toHaveBeenCalledOnce();
  });

  it('arquivo fora do store ou sumido: null', async () => {
    const { preview } = setup(null);
    await expect(preview.build('t1', 'https://outro/x.jpg')).resolves.toBeNull();
  });

  it('erro na redução: null e libera o arquivo', async () => {
    const images = { resizeJpeg: vi.fn().mockRejectedValue(new Error('bad')) } as unknown as IImageTranscoder;
    const { preview, release } = setup(photo, images);
    await expect(preview.build('t1', 'https://cdn/media/offer-1.jpg')).resolves.toBeNull();
    expect(release).toHaveBeenCalledOnce();
  });
});

describe('OfferPreviewImage — marca d\'água', () => {
  it.each(['jpeg', 'png', 'webp'] as const)('%s: imagem e miniatura marcadas no canto escolhido, oposto intacto, origem inalterada', async (fmt) => {
    const before = await readFile(sources[fmt]);
    const { preview } = setup(sources[fmt], undefined, await realDecorator());
    const out = await preview.build('t1', 'https://cdn/media/src');
    // Canto superior esquerdo vermelho (logo), inferior direito cinza
    const big = await pixel(out!.imageJpeg, 40, 40);
    expect(big.r).toBeGreaterThan(200);
    expect(big.g).toBeLessThan(70);
    const bigOpp = await pixel(out!.imageJpeg, 590, 390);
    expect(Math.abs(bigOpp.r - 128)).toBeLessThan(15);
    const thumb = await pixel(out!.thumbnailJpeg, 14, 14);
    expect(thumb.r).toBeGreaterThan(200);
    expect(thumb.g).toBeLessThan(80);
    expect((await readFile(sources[fmt])).equals(before)).toBe(true);
  });

  it.each([
    ['sem plano', { plan: false }],
    ['desligada', { record: { enabled: false } }],
    ['sem registro', { record: null }],
    ['sem logo (tipo IMAGE)', { record: { imageKey: null } }],
    ['logo corrompido', { logo: Buffer.from('nope') }],
    ['storage fora', { logo: new Error('s3 down') }],
  ] as const)('%s: bytes iguais aos de hoje', async (_n, over) => {
    const { preview } = setup(sources.png, undefined, await realDecorator(over as never));
    const out = await preview.build('t1', 'https://cdn/media/src');
    const ref = await today(sources.png);
    expect(out!.imageJpeg.equals(ref.imageJpeg)).toBe(true);
    expect(out!.thumbnailJpeg.equals(ref.thumbnailJpeg)).toBe(true);
  });

  it('sem decorador: bytes iguais aos de hoje', async () => {
    const out = await setup(photo).preview.build('t1', 'https://cdn/media/offer-1.jpg');
    const ref = await today(photo);
    expect(out!.imageJpeg.equals(ref.imageJpeg)).toBe(true);
    expect(out!.thumbnailJpeg.equals(ref.thumbnailJpeg)).toBe(true);
  });

  it('passa o tenant ao decorador', async () => {
    const decorate = vi.fn(async (_t: string, b: Buffer) => b);
    await setup(photo, undefined, { applies: vi.fn(), decorate }).preview.build('t9', 'https://cdn/media/offer-1.jpg');
    expect(decorate).toHaveBeenCalledWith('t9', expect.any(Buffer));
  });
});
