/**
 * Gera as miniaturas da grade de templates do painel: `pnpm story:thumbs` (cwd = `api/`).
 * Saída: `app/public/assets/offer-story/<id>.webp` (360×640). Rodar de novo ao mudar um layout.
 * Só usa o renderer (sem banco, sem engine de mensageria).
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { OFFER_STORY_TEMPLATES } from '../../domain/offerStoryTemplates';
import { SatoriOfferStoryRenderer } from '../adapters/SatoriOfferStoryRenderer';
import { sampleRenderInput } from './offerStorySample';

const OUTPUT_DIR = path.resolve(process.cwd(), '../app/public/assets/offer-story');

async function main(): Promise<void> {
  await mkdir(OUTPUT_DIR, { recursive: true });
  const renderer = new SatoriOfferStoryRenderer();
  for (const template of OFFER_STORY_TEMPLATES) {
    const story = await renderer.render(await sampleRenderInput(template));
    const thumb = await sharp(story.buffer).resize(360, 640).webp({ quality: 82 }).toBuffer();
    await writeFile(path.join(OUTPUT_DIR, `${template.id}.webp`), thumb);
    console.log(`${template.id}.webp ${Math.round(thumb.length / 1024)} KiB`);
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
