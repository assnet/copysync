/**
 * Regras da marca d'água própria das ofertas (spec IMG-06/07/14): funções puras, sem banco.
 *
 * Como `storefrontRules.ts`, devolvem resultado discriminado (ok | invalid) em vez de lançar: o
 * domínio não depende de erro HTTP; o use case traduz.
 */

export const OFFER_WATERMARK_KINDS = ['IMAGE', 'TEXT'] as const;
/** `IMAGE` usa o logo, `TEXT` usa o texto: uma fonte só, nunca as duas. */
export type OfferWatermarkKind = (typeof OFFER_WATERMARK_KINDS)[number];

export const OFFER_WATERMARK_POSITIONS = ['TOP_LEFT', 'TOP_RIGHT', 'BOTTOM_LEFT', 'BOTTOM_RIGHT', 'CENTER'] as const;
export type OfferWatermarkPosition = (typeof OFFER_WATERMARK_POSITIONS)[number];

export const OFFER_WATERMARK_SIZES = ['SMALL', 'MEDIUM', 'LARGE'] as const;
export type OfferWatermarkSize = (typeof OFFER_WATERMARK_SIZES)[number];

/** Padrões do schema (`OfferWatermark` no Prisma). */
export const OFFER_WATERMARK_DEFAULTS = {
  kind: 'IMAGE' as OfferWatermarkKind,
  enabled: false,
  position: 'BOTTOM_RIGHT' as OfferWatermarkPosition,
  size: 'MEDIUM' as OfferWatermarkSize,
  opacity: 80,
} as const;

/** Opacidade em %, inteira. */
export const OFFER_WATERMARK_OPACITY_MIN = 20;
export const OFFER_WATERMARK_OPACITY_MAX = 100;

/** Texto da marca: uma linha, contado em caracteres (code points, como o `VARCHAR(32)`). */
export const OFFER_WATERMARK_TEXT_MIN_LENGTH = 1;
export const OFFER_WATERMARK_TEXT_MAX_LENGTH = 32;

/** Logo enviado: validado pelo conteúdo (não pelo mime), normalizado para PNG com lado maior ≤ 512 px. */
export const OFFER_WATERMARK_LOGO_FORMATS = ['png', 'webp'] as const;
export const OFFER_WATERMARK_LOGO_MAX_BYTES = 1024 * 1024;
export const OFFER_WATERMARK_LOGO_MIN_SIDE = 100;
export const OFFER_WATERMARK_LOGO_NORMALIZED_MAX_SIDE = 512;

/** Largura da marca como fração do lado menor da foto. */
export const OFFER_WATERMARK_SIZE_RATIO: Readonly<Record<OfferWatermarkSize, number>> = {
  SMALL: 0.15,
  MEDIUM: 0.22,
  LARGE: 0.3,
};
/** Margem até a borda, fração do lado menor da foto. */
export const OFFER_WATERMARK_MARGIN_RATIO = 0.04;

export type RuleResult<T> = { kind: 'ok'; value: T } | { kind: 'invalid' };

const ok = <T>(value: T): RuleResult<T> => ({ kind: 'ok', value });
const INVALID = { kind: 'invalid' } as const;

export function validateWatermarkOpacity(raw: number): RuleResult<number> {
  return Number.isInteger(raw) && raw >= OFFER_WATERMARK_OPACITY_MIN && raw <= OFFER_WATERMARK_OPACITY_MAX
    ? ok(raw)
    : INVALID;
}

/** Quebra de linha (inclusive U+2028/U+2029) em qualquer ponto, mesmo nas pontas, recusa o texto. */
const LINE_BREAK = /[\r\n\u2028\u2029]/;
/** Caractere de controle (tab, NUL…) recusado. */
const CONTROL = /\p{Cc}/u;

/** Texto da marca: trim, uma linha, sem caractere de controle, 1–32 caracteres. */
export function validateWatermarkText(raw: string): RuleResult<string> {
  if (LINE_BREAK.test(raw)) return INVALID;
  const value = raw.trim();
  if (CONTROL.test(value)) return INVALID;
  const length = [...value].length;
  return length >= OFFER_WATERMARK_TEXT_MIN_LENGTH && length <= OFFER_WATERMARK_TEXT_MAX_LENGTH ? ok(value) : INVALID;
}

export function isWatermarkKind(raw: unknown): raw is OfferWatermarkKind {
  return (OFFER_WATERMARK_KINDS as readonly unknown[]).includes(raw);
}

export function isWatermarkPosition(raw: unknown): raw is OfferWatermarkPosition {
  return (OFFER_WATERMARK_POSITIONS as readonly unknown[]).includes(raw);
}

export function isWatermarkSize(raw: unknown): raw is OfferWatermarkSize {
  return (OFFER_WATERMARK_SIZES as readonly unknown[]).includes(raw);
}
