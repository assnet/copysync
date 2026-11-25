import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { SharpOfferWatermarkLogoProcessor } from './SharpOfferWatermarkLogoProcessor';

const processor = new SharpOfferWatermarkLogoProcessor();

const rgba = (width: number, height: number) =>
  sharp({ create: { width, height, channels: 4, background: { r: 200, g: 30, b: 30, alpha: 0.5 } } });
const rgb = (width: number, height: number) =>
  sharp({ create: { width, height, channels: 3, background: { r: 200, g: 30, b: 30 } } });

const logoFixtures = {
  png: () => rgba(300, 200).png().toBuffer(),
  webp: () => rgba(300, 200).webp().toBuffer(),
  bigPng: () => rgba(2000, 1000).png().toBuffer(),
  jpeg: () => rgb(300, 200).jpeg().toBuffer(),
  pngWithoutAlpha: () => rgb(300, 200).png().toBuffer(),
  tinyPng: () => rgba(99, 300).png().toBuffer(),
};

describe('SharpOfferWatermarkLogoProcessor', () => {
  it('PNG com alfa: devolve PNG com alfa, sem aumentar', async () => {
    const out = await processor.normalize(await logoFixtures.png());
    const meta = await sharp(out.buffer).metadata();
    expect(meta).toMatchObject({ format: 'png', hasAlpha: true, width: 300, height: 200 });
    expect(out).toMatchObject({ width: 300, height: 200 });
  });

  it('WebP com alfa vira PNG', async () => {
    const out = await processor.normalize(await logoFixtures.webp());
    expect((await sharp(out.buffer).metadata()).format).toBe('png');
  });

  it('grande: lado maior reduzido a 512 px, proporção mantida', async () => {
    const out = await processor.normalize(await logoFixtures.bigPng());
    const meta = await sharp(out.buffer).metadata();
    expect(meta).toMatchObject({ format: 'png', width: 512, height: 256 });
  });

  it('JPEG (sem alfa) → UNSUPPORTED_MEDIA_TYPE', async () => {
    await expect(processor.normalize(await logoFixtures.jpeg())).rejects.toMatchObject({ code: 'UNSUPPORTED_MEDIA_TYPE', statusCode: 415 });
  });

  it('PNG sem transparência → UNSUPPORTED_MEDIA_TYPE', async () => {
    await expect(processor.normalize(await logoFixtures.pngWithoutAlpha())).rejects.toMatchObject({ code: 'UNSUPPORTED_MEDIA_TYPE' });
  });

  it('conteúdo que não é imagem (mime falso) → UNSUPPORTED_MEDIA_TYPE', async () => {
    await expect(processor.normalize(Buffer.from('<svg>não é png</svg>'))).rejects.toMatchObject({ code: 'UNSUPPORTED_MEDIA_TYPE' });
  });

  it('> 1 MiB → MEDIA_TOO_LARGE', async () => {
    await expect(processor.normalize(Buffer.alloc(1024 * 1024 + 1))).rejects.toMatchObject({ code: 'MEDIA_TOO_LARGE', statusCode: 413 });
  });

  it('< 100×100 → MEDIA_PROCESSING_FAILED com o mínimo', async () => {
    await expect(processor.normalize(await logoFixtures.tinyPng())).rejects.toMatchObject({
      code: 'MEDIA_PROCESSING_FAILED', statusCode: 422, meta: { minWidth: 100, minHeight: 100 },
    });
  });

  it('PNG truncado (cabeçalho ok, dados ilegíveis) → MEDIA_PROCESSING_FAILED', async () => {
    const png = await logoFixtures.png();
    await expect(processor.normalize(png.subarray(0, 100))).rejects.toMatchObject({ code: 'MEDIA_PROCESSING_FAILED' });
  });
});
