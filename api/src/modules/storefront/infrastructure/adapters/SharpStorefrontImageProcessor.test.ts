import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { SharpStorefrontImageProcessor } from './SharpStorefrontImageProcessor';
import { STOREFRONT_IMAGE_PRESETS } from '../../domain/services/storefrontRules';

const processor = new SharpStorefrontImageProcessor();

function image(width: number, height: number, format: 'png' | 'jpeg' | 'webp' | 'gif' = 'png') {
  return sharp({ create: { width, height, channels: 3, background: '#3366cc' } })[format]().toBuffer();
}

describe('SharpStorefrontImageProcessor', () => {
  it('capa jpeg 1600×800 → WebP 1500×500 recortado', async () => {
    const out = await processor.process(await image(1600, 800, 'jpeg'), 'cover');
    expect(out).toMatchObject({ width: 1500, height: 500 });
    const meta = await sharp(out.buffer).metadata();
    expect(meta).toMatchObject({ format: 'webp', width: 1500, height: 500 });
  });

  it('avatar sai quadrado 320² sem EXIF', async () => {
    const input = await sharp(await image(400, 300, 'jpeg'))
      .withMetadata({ exif: { IFD0: { Copyright: 'x' } } })
      .jpeg()
      .toBuffer();
    expect((await sharp(input).metadata()).exif).toBeDefined();
    const out = await processor.process(input, 'avatar');
    const meta = await sharp(out.buffer).metadata();
    expect(meta).toMatchObject({ format: 'webp', width: 320, height: 320 });
    expect(meta.exif).toBeUndefined();
  });

  it('oferta 2000×1000 → 600×300; pequena não é ampliada', async () => {
    const big = await processor.process(await image(2000, 1000, 'webp'), 'offer');
    expect(big).toMatchObject({ width: 600, height: 300 });
    const small = await processor.process(await image(100, 50), 'offer');
    expect(small).toMatchObject({ width: 100, height: 50 });
  });

  it('png abaixo da dimensão mínima → 422', async () => {
    await expect(processor.process(await image(100, 100), 'avatar')).rejects.toMatchObject({
      code: 'MEDIA_PROCESSING_FAILED',
    });
    await expect(processor.process(await image(1600, 300, 'jpeg'), 'cover')).rejects.toMatchObject({
      code: 'MEDIA_PROCESSING_FAILED',
    });
  });

  it('conteúdo que não é imagem ou formato fora da lista → 415', async () => {
    await expect(processor.process(Buffer.from('texto qualquer'), 'offer')).rejects.toMatchObject({
      code: 'UNSUPPORTED_MEDIA_TYPE',
    });
    await expect(processor.process(await image(300, 300, 'gif'), 'avatar')).rejects.toMatchObject({
      code: 'UNSUPPORTED_MEDIA_TYPE',
    });
  });

  it('arquivo acima do máximo do preset → 413', async () => {
    const huge = Buffer.alloc(STOREFRONT_IMAGE_PRESETS.avatar.maxInputBytes + 1);
    await expect(processor.process(huge, 'avatar')).rejects.toMatchObject({ code: 'MEDIA_TOO_LARGE' });
  });

  it('imagem truncada → 422, nunca erro cru do sharp', async () => {
    const jpeg = await image(1600, 800, 'jpeg');
    await expect(processor.process(jpeg.subarray(0, 400), 'cover')).rejects.toMatchObject({
      code: expect.stringMatching(/^(MEDIA_PROCESSING_FAILED|UNSUPPORTED_MEDIA_TYPE)$/),
    });
  });
});
