import { describe, expect, it } from 'vitest';
import { computeWatermarkPlacement } from './computeWatermarkPlacement';
import { OFFER_WATERMARK_POSITIONS, OFFER_WATERMARK_SIZES } from './offerWatermarkRules';

const PHOTOS = {
  retrato: { width: 600, height: 900 },
  paisagem: { width: 1200, height: 675 },
  quadrada: { width: 800, height: 800 },
};
const MARKS = { larga: { width: 512, height: 128 }, quadrada: { width: 300, height: 300 }, alta: { width: 50, height: 500 } };
const RATIO = { SMALL: 0.15, MEDIUM: 0.22, LARGE: 0.3 } as const;

describe('computeWatermarkPlacement', () => {
  for (const [photoName, photo] of Object.entries(PHOTOS)) {
    for (const [markName, mark] of Object.entries(MARKS)) {
      for (const position of OFFER_WATERMARK_POSITIONS) {
        for (const size of OFFER_WATERMARK_SIZES) {
          it(`${photoName} × marca ${markName} × ${position} × ${size}: dentro da foto, com margem`, () => {
            const p = computeWatermarkPlacement(photo, mark, position, size);
            const minSide = Math.min(photo.width, photo.height);
            const margin = Math.floor(minSide * 0.04);
            for (const v of Object.values(p)) expect(Number.isInteger(v)).toBe(true);
            expect(p.width).toBeGreaterThan(0);
            expect(p.height).toBeGreaterThan(0);
            expect(p.left).toBeGreaterThanOrEqual(margin);
            expect(p.top).toBeGreaterThanOrEqual(margin);
            expect(p.left + p.width).toBeLessThanOrEqual(photo.width - margin);
            expect(p.top + p.height).toBeLessThanOrEqual(photo.height - margin);
            if (markName !== 'alta') {
              expect(p.width).toBe(Math.round(minSide * RATIO[size]));
              expect(p.height).toBe(Math.round((p.width * mark.height) / mark.width));
            }
            if (position.startsWith('TOP')) expect(p.top).toBe(margin);
            if (position.startsWith('BOTTOM')) expect(p.top + p.height).toBe(photo.height - margin);
            if (position.endsWith('LEFT')) expect(p.left).toBe(margin);
            if (position.endsWith('RIGHT')) expect(p.left + p.width).toBe(photo.width - margin);
            if (position === 'CENTER') {
              expect(Math.abs(p.left * 2 + p.width - photo.width)).toBeLessThanOrEqual(1);
              expect(Math.abs(p.top * 2 + p.height - photo.height)).toBeLessThanOrEqual(1);
            }
          });
        }
      }
    }
  }

  it('marca alta demais é reduzida mantendo a proporção', () => {
    const p = computeWatermarkPlacement({ width: 1200, height: 200 }, { width: 50, height: 500 }, 'TOP_LEFT', 'LARGE');
    expect(p.height).toBe(200 - 2 * 8);
    expect(p.width).toBe(Math.round(p.height / 10));
  });

  it('tamanhos crescem SMALL < MEDIUM < LARGE', () => {
    const w = (s: 'SMALL' | 'MEDIUM' | 'LARGE') =>
      computeWatermarkPlacement(PHOTOS.quadrada, MARKS.larga, 'CENTER', s).width;
    expect(w('SMALL')).toBeLessThan(w('MEDIUM'));
    expect(w('MEDIUM')).toBeLessThan(w('LARGE'));
  });
});
