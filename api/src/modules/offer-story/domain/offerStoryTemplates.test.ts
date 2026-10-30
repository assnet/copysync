import { existsSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { OFFER_STORY_TEMPLATES, findOfferStoryTemplate } from './offerStoryTemplates';

const THUMBS_DIR = path.resolve(__dirname, '../../../../../app/public/assets/offer-story');

describe('OFFER_STORY_TEMPLATES', () => {
  it('ids são únicos e todos 1080×1920', () => {
    const ids = OFFER_STORY_TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const t of OFFER_STORY_TEMPLATES) expect([t.width, t.height]).toEqual([1080, 1920]);
  });

  it('cada id tem miniatura .webp no painel (pnpm story:thumbs)', () => {
    for (const { id } of OFFER_STORY_TEMPLATES) {
      expect(existsSync(path.join(THUMBS_DIR, `${id}.webp`)), id).toBe(true);
    }
  });

  it('findOfferStoryTemplate devolve null para id desconhecido', () => {
    expect(findOfferStoryTemplate('flash-night')?.id).toBe('flash-night');
    expect(findOfferStoryTemplate('nao-existe')).toBeNull();
  });
});
