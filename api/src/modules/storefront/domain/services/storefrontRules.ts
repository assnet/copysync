/**
 * Regras da Página de Ofertas: funções puras, sem banco (spec.md P1; context.md decisões 5–8).
 *
 * Decisão: como `slugRules.ts`, devolvem resultado discriminado (ok | invalid) em vez de lançar —
 * o domínio não depende de erro HTTP; o use case traduz. Slug segue `link-rotation/.../slugRules.ts`.
 */
import { isStorefrontCategory, type StorefrontCategoryKey } from './storefrontCategories';

export const STOREFRONT_NAME_MIN_LENGTH = 2;
export const STOREFRONT_NAME_MAX_LENGTH = 60;
export const STOREFRONT_SUBTITLE_MAX_LENGTH = 80;
export const STOREFRONT_OFFER_TITLE_MAX_LENGTH = 140;

/** Limites de domínio, não entitlement (context.md decisão 5). */
export const STOREFRONT_MAX_OFFERS = 200;
export const STOREFRONT_MAX_PUBLISHED_OFFERS = 60;

/** Padrões do schema (`Storefront.color*`). */
export const STOREFRONT_DEFAULT_COLORS = {
  colorPrimary: '#2563EB',
  colorBackground: '#F5F5F5',
  colorCard: '#FFFFFF',
} as const;

/** Sugestões clicáveis do campo subtítulo (spec.md P1 passo 8). Texto livre também vale. */
export const STOREFRONT_SUBTITLE_SUGGESTIONS: readonly string[] = [
  '🔥 Ofertas selecionadas pra você',
  '🛒 As melhores promoções do dia',
  '💰 Promoções exclusivas',
  '✨ Ofertas que valem a pena',
];

export type RuleResult<T> = { kind: 'ok'; value: T } | { kind: 'invalid' };

const ok = <T>(value: T): RuleResult<T> => ({ kind: 'ok', value });
const INVALID = { kind: 'invalid' } as const;

function lengthBetween(raw: string, min: number, max: number): RuleResult<string> {
  const value = raw.trim();
  return value.length >= min && value.length <= max ? ok(value) : INVALID;
}

export function validateStorefrontName(raw: string): RuleResult<string> {
  return lengthBetween(raw, STOREFRONT_NAME_MIN_LENGTH, STOREFRONT_NAME_MAX_LENGTH);
}

/** Opcional: vazio/só espaço vira null. */
export function validateStorefrontSubtitle(raw: string | null | undefined): RuleResult<string | null> {
  const value = (raw ?? '').trim();
  if (!value) return ok(null);
  return value.length <= STOREFRONT_SUBTITLE_MAX_LENGTH ? ok(value) : INVALID;
}

export function validateOfferTitle(raw: string): RuleResult<string> {
  return lengthBetween(raw, 1, STOREFRONT_OFFER_TITLE_MAX_LENGTH);
}

/** Preço em centavos: inteiro ≥ 0, ou null (sem preço). */
export function validatePriceCents(raw: number | null | undefined): RuleResult<number | null> {
  if (raw === null || raw === undefined) return ok(null);
  return Number.isSafeInteger(raw) && raw >= 0 ? ok(raw) : INVALID;
}

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

/**
 * Só `#RRGGBB` (sem atalho de 3 dígitos, sem alfa); devolve maiúsculo ou null. A cor vai para
 * custom property CSS na página pública: qualquer outra forma é rejeitada (sem injeção de CSS).
 */
export function normalizeHexColor(raw: string): string | null {
  const value = raw.trim();
  return HEX_COLOR.test(value) ? value.toUpperCase() : null;
}

/** Subconjunto do catálogo fixo, sem duplicata; preserva a ordem escolhida. */
export function validateStorefrontCategories(raw: readonly string[]): RuleResult<StorefrontCategoryKey[]> {
  const out: StorefrontCategoryKey[] = [];
  for (const key of raw) {
    if (!isStorefrontCategory(key) || out.includes(key)) return INVALID;
    out.push(key);
  }
  return ok(out);
}

/** Categoria da oferta só vale se a página a mostra; senão "Sem categoria" (null). */
export function keepOfferCategory(category: string | null, pageCategories: readonly string[]): string | null {
  return category !== null && pageCategories.includes(category) ? category : null;
}

export interface StorefrontConfigInput {
  title: string;
  subtitle?: string | null;
  colorPrimary: string;
  colorBackground: string;
  colorCard: string;
  categories: readonly string[];
}

export interface StorefrontConfig {
  title: string;
  subtitle: string | null;
  colorPrimary: string;
  colorBackground: string;
  colorCard: string;
  categories: StorefrontCategoryKey[];
}

export type StorefrontConfigField = keyof StorefrontConfig;

export type StorefrontConfigValidation =
  | { kind: 'ok'; value: StorefrontConfig }
  | { kind: 'invalid'; field: StorefrontConfigField };

/** Valida e normaliza a configuração da página; para no primeiro campo inválido. */
export function validateStorefrontConfig(input: StorefrontConfigInput): StorefrontConfigValidation {
  const title = validateStorefrontName(input.title);
  if (title.kind === 'invalid') return { kind: 'invalid', field: 'title' };
  const subtitle = validateStorefrontSubtitle(input.subtitle);
  if (subtitle.kind === 'invalid') return { kind: 'invalid', field: 'subtitle' };
  const colors = {} as Pick<StorefrontConfig, 'colorPrimary' | 'colorBackground' | 'colorCard'>;
  for (const field of ['colorPrimary', 'colorBackground', 'colorCard'] as const) {
    const color = normalizeHexColor(input[field]);
    if (!color) return { kind: 'invalid', field };
    colors[field] = color;
  }
  const categories = validateStorefrontCategories(input.categories);
  if (categories.kind === 'invalid') return { kind: 'invalid', field: 'categories' };
  return {
    kind: 'ok',
    value: { title: title.value, subtitle: subtitle.value, ...colors, categories: categories.value },
  };
}

// ── Imagens (context.md decisões 6–8; design.md §4.5) ─────────────────────────

export type StorefrontImageKind = 'avatar' | 'cover' | 'offer';

export interface StorefrontImagePreset {
  /** Tamanho máximo do arquivo de entrada. */
  maxInputBytes: number;
  /** Dimensão mínima da entrada (0 = sem mínimo). */
  minWidth: number;
  minHeight: number;
  /** Saída WebP: `cover` recorta no tamanho exato; `inside` limita o lado maior. */
  output: { width: number; height: number; fit: 'cover' | 'inside' };
}

const MIB = 1024 * 1024;

export const STOREFRONT_IMAGE_PRESETS: Readonly<Record<StorefrontImageKind, StorefrontImagePreset>> = {
  avatar: { maxInputBytes: 2 * MIB, minWidth: 200, minHeight: 200, output: { width: 320, height: 320, fit: 'cover' } },
  cover: { maxInputBytes: 4 * MIB, minWidth: 1200, minHeight: 400, output: { width: 1500, height: 500, fit: 'cover' } },
  /** Imagem baixada do marketplace (≤ 5 MiB, spec.md P1 "Adicionar oferta" passo 4). */
  offer: { maxInputBytes: 5 * MIB, minWidth: 0, minHeight: 0, output: { width: 600, height: 600, fit: 'inside' } },
};

/** Qualidade WebP de saída e teto de pixels da entrada (anti bomba de descompressão). */
export const STOREFRONT_IMAGE_WEBP_QUALITY = 80;
export const STOREFRONT_IMAGE_MAX_INPUT_PIXELS = 40_000_000;
