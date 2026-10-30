import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { MediaProcessingFailedError } from '../../../../shared/errors/internal/MediaErrors';
import { OFFER_STORY_TEMPLATES } from '../../domain/offerStoryTemplates';
import { sampleRenderInput } from '../scripts/offerStorySample';
import { SatoriOfferStoryRenderer } from './SatoriOfferStoryRenderer';
import { OFFER_STORY_LAYOUTS } from './templates/offerStoryLayouts';

const renderer = new SatoriOfferStoryRenderer();
const [first] = OFFER_STORY_TEMPLATES;

async function expectStoryJpeg(buffer: Buffer): Promise<void> {
  const meta = await sharp(buffer).metadata();
  expect(meta.format).toBe('jpeg');
  expect([meta.width, meta.height]).toEqual([1080, 1920]);
}

describe('SatoriOfferStoryRenderer', () => {
  it('todo template do catálogo tem layout (e nenhum layout sobra)', () => {
    expect(Object.keys(OFFER_STORY_LAYOUTS).sort()).toEqual(OFFER_STORY_TEMPLATES.map((t) => t.id).sort());
  });

  it.each(OFFER_STORY_TEMPLATES.map((t) => [t.id, t] as const))('%s gera JPEG 1080×1920', async (_id, template) => {
    const out = await renderer.render(await sampleRenderInput(template));
    expect(out.mimeType).toBe('image/jpeg');
    expect(out.imageDropped).toBe(false);
    await expectStoryJpeg(out.buffer);
  }, 20_000);

  it('título longo, cupom de 20 caracteres e preço alto não quebram a arte', async () => {
    const input = await sampleRenderInput(first);
    input.headline = 'Kit Panelas Antiaderentes Alumínio Revestimento Interno e Externo '.repeat(4);
    input.coupon = { code: 'ABCDEFGHIJKLMNOPQRST', discountPercent: 90 };
    input.price = { fromCents: 1_299_990, toCents: 999_990 };
    await expectStoryJpeg((await renderer.render(input)).buffer);
  }, 20_000);

  it('sem foto, sem preço e sem cupom', async () => {
    const input = await sampleRenderInput(first);
    const out = await renderer.render({
      ...input,
      productImage: null,
      price: { fromCents: null, toCents: null },
      coupon: null,
    });
    expect(out.imageDropped).toBe(false);
    await expectStoryJpeg(out.buffer);
  }, 20_000);

  it('foto corrompida não falha a arte: imageDropped', async () => {
    const input = await sampleRenderInput(first);
    const out = await renderer.render({ ...input, productImage: Buffer.from('not an image') });
    expect(out.imageDropped).toBe(true);
    await expectStoryJpeg(out.buffer);
  }, 20_000);

  it('template sem layout vira MEDIA_PROCESSING_FAILED', async () => {
    const input = await sampleRenderInput(first);
    await expect(renderer.render({ ...input, template: { ...first, id: 'nope' } })).rejects.toBeInstanceOf(
      MediaProcessingFailedError,
    );
  });
});
