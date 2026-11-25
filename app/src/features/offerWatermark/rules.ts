import type { OfferWatermark, WatermarkDraft, WatermarkPosition, WatermarkSize } from './types';

/*
 * Espelho das regras da API (`api/src/modules/campaigns/domain/services/offerWatermarkRules.ts` e
 * `computeWatermarkPlacement.ts`). A API continua dona da regra: aqui só para a prévia e a checagem
 * leve antes de enviar. Mudou lá, muda aqui (o teste `rules.test.ts` fixa os mesmos números).
 */

export const WATERMARK_POSITIONS: readonly WatermarkPosition[] = ['TOP_LEFT', 'TOP_RIGHT', 'CENTER', 'BOTTOM_LEFT', 'BOTTOM_RIGHT'];
export const WATERMARK_SIZES: readonly WatermarkSize[] = ['SMALL', 'MEDIUM', 'LARGE'];

export const WATERMARK_OPACITY_MIN = 20;
export const WATERMARK_OPACITY_MAX = 100;
export const WATERMARK_TEXT_MAX_LENGTH = 32;

/** Logo: PNG ou WebP (com transparência), até 1 MiB, lado menor ≥ 100 px (dimensão conferida na API). */
export const WATERMARK_LOGO_TYPES = ['image/png', 'image/webp'] as const;
export const WATERMARK_LOGO_MAX_BYTES = 1024 * 1024;

/** Largura da marca como fração do lado menor da foto. */
export const WATERMARK_SIZE_RATIO: Readonly<Record<WatermarkSize, number>> = { SMALL: 0.15, MEDIUM: 0.22, LARGE: 0.3 };
/** Margem até a borda, fração do lado menor da foto. */
export const WATERMARK_MARGIN_RATIO = 0.04;

/** Padrões da API (sem registro salvo). */
export const WATERMARK_DEFAULTS: WatermarkDraft = {
  enabled: false, kind: 'IMAGE', text: '', position: 'BOTTOM_RIGHT', size: 'MEDIUM', opacity: 80,
};

export interface Dimensions { width: number; height: number }
export interface WatermarkPlacement { width: number; height: number; left: number; top: number }

/** Cópia fiel de `computeWatermarkPlacement` da API (pixels inteiros, marca sempre dentro da foto). */
export function computeWatermarkPlacement(photo: Dimensions, mark: Dimensions, position: WatermarkPosition, size: WatermarkSize): WatermarkPlacement {
  const photoW = Math.max(1, Math.floor(photo.width));
  const photoH = Math.max(1, Math.floor(photo.height));
  const minSide = Math.min(photoW, photoH);
  const margin = Math.floor(minSide * WATERMARK_MARGIN_RATIO);
  const aspect = mark.width > 0 && mark.height > 0 ? mark.height / mark.width : 1;

  const maxW = Math.max(1, photoW - 2 * margin);
  const maxH = Math.max(1, photoH - 2 * margin);
  let width = Math.min(maxW, Math.max(1, Math.round(minSide * WATERMARK_SIZE_RATIO[size])));
  let height = Math.max(1, Math.round(width * aspect));
  if (height > maxH) {
    height = maxH;
    width = Math.min(maxW, Math.max(1, Math.round(height / aspect)));
  }

  const right = photoW - margin - width;
  const bottom = photoH - margin - height;
  switch (position) {
    case 'TOP_LEFT':
      return { width, height, left: margin, top: margin };
    case 'TOP_RIGHT':
      return { width, height, left: right, top: margin };
    case 'BOTTOM_LEFT':
      return { width, height, left: margin, top: bottom };
    case 'BOTTOM_RIGHT':
      return { width, height, left: right, top: bottom };
    case 'CENTER':
      return { width, height, left: Math.floor((photoW - width) / 2), top: Math.floor((photoH - height) / 2) };
  }
}

/**
 * Proporção aproximada do texto como a API o desenha (Inter 800 a 120 px, sombra, recorte ao conteúdo).
 * No navegador mede pelo canvas; sem canvas (testes) estima pela média de largura dos caracteres.
 */
const TEXT_FONT_PX = 120;
const TEXT_SHADOW_PX = 20;
const TEXT_INK_HEIGHT = TEXT_FONT_PX * 0.95 + TEXT_SHADOW_PX * 2;

export function textMarkDimensions(text: string, measure?: (text: string) => number | null): Dimensions {
  const value = text.trim() || ' ';
  const measured = measure?.(value);
  const glyphs = measured && measured > 0 ? measured : [...value].length * TEXT_FONT_PX * 0.62;
  return { width: glyphs + TEXT_SHADOW_PX * 2, height: TEXT_INK_HEIGHT };
}

/** Largura do texto na fonte da marca pelo canvas; null sem canvas. */
export function measureWatermarkText(text: string): number | null {
  try {
    const ctx = document.createElement('canvas').getContext('2d');
    if (!ctx) return null;
    ctx.font = `800 ${TEXT_FONT_PX}px Inter, system-ui, sans-serif`;
    return ctx.measureText(text).width;
  } catch {
    return null;
  }
}

export type WatermarkTextProblem = 'empty' | 'tooLong' | 'lineBreak';

/** Mesma regra da API: trim, uma linha, 1–32 caracteres (code points). null = válido. */
export function checkWatermarkText(raw: string): WatermarkTextProblem | null {
  if (/[\r\n\u2028\u2029]/.test(raw)) return 'lineBreak';
  const length = textLength(raw.trim());
  if (length === 0) return 'empty';
  return length > WATERMARK_TEXT_MAX_LENGTH ? 'tooLong' : null;
}

export const textLength = (value: string): number => [...value].length;

export type WatermarkLogoProblem = 'UNSUPPORTED_MEDIA_TYPE' | 'MEDIA_TOO_LARGE';

/** Checagem leve antes de subir (tipo e tamanho); conteúdo, transparência e dimensão são da API. */
export function checkWatermarkLogo(file: Pick<File, 'type' | 'size'>): WatermarkLogoProblem | null {
  if (!(WATERMARK_LOGO_TYPES as readonly string[]).includes(file.type)) return 'UNSUPPORTED_MEDIA_TYPE';
  return file.size > WATERMARK_LOGO_MAX_BYTES ? 'MEDIA_TOO_LARGE' : null;
}

/** Ajustes do servidor no formato do rascunho. */
export function toDraft(w: OfferWatermark): WatermarkDraft {
  return { enabled: w.enabled, kind: w.kind, text: w.text ?? '', position: w.position, size: w.size, opacity: w.opacity };
}

export function isDraftDirty(draft: WatermarkDraft | null, saved: OfferWatermark | null): boolean {
  if (!draft || !saved) return false;
  const base = toDraft(saved);
  return (Object.keys(base) as (keyof WatermarkDraft)[]).some((k) => (k === 'text' ? draft.text.trim() !== base.text : draft[k] !== base[k]));
}

/** Rascunho → `PUT` (texto vazio apaga; o outro tipo nunca é apagado ao trocar). */
export function draftToUpdate(d: WatermarkDraft) {
  const text = d.text.trim();
  return { enabled: d.enabled, kind: d.kind, text: text === '' ? null : text, position: d.position, size: d.size, opacity: d.opacity };
}

/** Rascunho válido para salvar: no tipo texto, o texto tem de passar na regra. */
export function draftProblem(d: WatermarkDraft): WatermarkTextProblem | null {
  if (d.kind === 'TEXT') return checkWatermarkText(d.text);
  return d.text.trim() === '' ? null : checkWatermarkText(d.text);
}
