import { describe, expect, it } from 'vitest';
import {
  WATERMARK_POSITIONS, WATERMARK_SIZES, checkWatermarkLogo, checkWatermarkText, computeWatermarkPlacement, draftProblem, draftToUpdate,
  isDraftDirty, textMarkDimensions, toDraft,
} from './rules';
import type { OfferWatermark } from './types';

const saved: OfferWatermark = {
  enabled: true, kind: 'TEXT', text: 'Achados', position: 'BOTTOM_RIGHT', size: 'MEDIUM', opacity: 80,
  imageUrl: null, canEdit: true, updatedAt: null,
};

describe('computeWatermarkPlacement (espelho da API)', () => {
  // Mesmos números da regra da API: lado menor × 15/22/30 %, margem 4 %
  const photo = { width: 800, height: 800 };
  const mark = { width: 512, height: 128 };

  it.each(WATERMARK_SIZES.map((s, i) => [s, [120, 176, 240][i]] as const))('%s → largura %i em foto 800', (size, width) => {
    expect(computeWatermarkPlacement(photo, mark, 'CENTER', size).width).toBe(width);
  });

  it('5 posições com margem de 32 px na foto 800 (MEDIUM: 176 × 44)', () => {
    const at = (p: (typeof WATERMARK_POSITIONS)[number]) => computeWatermarkPlacement(photo, mark, p, 'MEDIUM');
    expect(at('TOP_LEFT')).toEqual({ width: 176, height: 44, left: 32, top: 32 });
    expect(at('TOP_RIGHT')).toEqual({ width: 176, height: 44, left: 592, top: 32 });
    expect(at('BOTTOM_LEFT')).toEqual({ width: 176, height: 44, left: 32, top: 724 });
    expect(at('BOTTOM_RIGHT')).toEqual({ width: 176, height: 44, left: 592, top: 724 });
    expect(at('CENTER')).toEqual({ width: 176, height: 44, left: 312, top: 378 });
  });

  it('marca alta demais é reduzida mantendo a proporção (igual à API)', () => {
    const p = computeWatermarkPlacement({ width: 1200, height: 200 }, { width: 50, height: 500 }, 'TOP_LEFT', 'LARGE');
    expect(p.height).toBe(200 - 2 * 8);
    expect(p.width).toBe(Math.round(p.height / 10));
  });

  it('texto: medida do canvas quando houver; senão estimativa', () => {
    const ink = { x: -2, y: -90, width: 300, height: 92 };
    expect(textMarkDimensions('Ana', () => ink)).toEqual(ink);
    expect(textMarkDimensions('Ana').width).toBeGreaterThan(textMarkDimensions('A').width);
  });

  // Mesmos números da API (modo `height`): altura das letras = lado menor × 5/7/9 %, margem 4 %
  const FRASE = { width: 1180, height: 118 };
  it.each(WATERMARK_SIZES.map((s, i) => [s, [30, 42, 54][i]] as const))('texto %s → altura %i em foto 600', (size, height) => {
    const p = computeWatermarkPlacement({ width: 600, height: 600 }, FRASE, 'CENTER', size, 'height');
    expect(p.height).toBe(height);
    expect(p.width).toBe(height * 10);
  });

  it('texto 600×600 MEDIUM no canto: 420 × 42 com margem 24 (igual à API)', () => {
    expect(computeWatermarkPlacement({ width: 600, height: 600 }, FRASE, 'BOTTOM_RIGHT', 'MEDIUM', 'height'))
      .toEqual({ width: 420, height: 42, left: 156, top: 534 });
  });

  it('texto mais largo que a área útil: reduz mantendo a proporção (igual à API)', () => {
    const p = computeWatermarkPlacement({ width: 600, height: 600 }, { width: 3000, height: 100 }, 'TOP_LEFT', 'LARGE', 'height');
    expect(p).toEqual({ width: 552, height: 18, left: 24, top: 24 });
  });
});

describe('regras de entrada', () => {
  it('texto: 1–32 caracteres numa linha (code points)', () => {
    expect(checkWatermarkText('  ')).toBe('empty');
    expect(checkWatermarkText('a'.repeat(32))).toBeNull();
    expect(checkWatermarkText('a'.repeat(33))).toBe('tooLong');
    expect(checkWatermarkText('😀'.repeat(32))).toBeNull();
    expect(checkWatermarkText('a\nb')).toBe('lineBreak');
  });

  it('logo: PNG/WebP até 1 MiB', () => {
    expect(checkWatermarkLogo({ type: 'image/png', size: 1024 * 1024 })).toBeNull();
    expect(checkWatermarkLogo({ type: 'image/webp', size: 1024 * 1024 + 1 })).toBe('MEDIA_TOO_LARGE');
    expect(checkWatermarkLogo({ type: 'image/jpeg', size: 10 })).toBe('UNSUPPORTED_MEDIA_TYPE');
  });

  it('rascunho: sujo só se diferente; texto vazio vira null; tipo logo aceita texto vazio', () => {
    const d = toDraft(saved);
    expect(isDraftDirty(d, saved)).toBe(false);
    expect(isDraftDirty({ ...d, text: 'Achados ' }, saved)).toBe(false);
    expect(isDraftDirty({ ...d, opacity: 60 }, saved)).toBe(true);
    expect(draftToUpdate({ ...d, kind: 'IMAGE', text: '' })).toMatchObject({ kind: 'IMAGE', text: null });
    expect(draftProblem({ ...d, kind: 'IMAGE', text: '' })).toBeNull();
    expect(draftProblem({ ...d, kind: 'TEXT', text: '' })).toBe('empty');
  });
});
