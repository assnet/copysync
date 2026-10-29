/**
 * Regras do nome do link (subdomínio): função pura, sem banco.
 *
 * Decisão: `validateSlug` devolve resultado discriminado (ok | invalid | reserved) em vez de
 * lançar — o domínio não depende de erro HTTP. O use case traduz para `LinkSlugInvalidError` /
 * `LinkSlugReservedError` (shared/errors/internal/LinkRotationErrors.ts). Disponibilidade
 * (unique + reserva de 30 dias) não é regra pura: `suggestSlugs` recebe o predicado por parâmetro.
 */

/** 3–50 caracteres, a-z0-9 e hífen, sem hífen nas pontas. */
export const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/;
export const SLUG_MIN_LENGTH = 3;
export const SLUG_MAX_LENGTH = 50;
export const MAX_SLUG_SUGGESTIONS = 5;

/** Reservados em todo domínio, além de `LinkDomain.reservedNames`. */
export const DEFAULT_RESERVED_SLUGS: readonly string[] = [
  'www', 'app', 'api', 'admin', 'mail', 'cdn', 'static', 'status', 'hub', 'probe',
];

export type SlugValidation =
  | { kind: 'ok'; slug: string }
  | { kind: 'invalid'; slug: string }
  | { kind: 'reserved'; slug: string };

/** Minúsculo, sem acento, espaço/underscore → hífen, hífens colapsados e aparados nas pontas. */
export function normalizeSlug(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function isReservedSlug(slug: string, extraReserved: readonly string[] = []): boolean {
  if (DEFAULT_RESERVED_SLUGS.includes(slug)) return true;
  return extraReserved.some((name) => normalizeSlug(name) === slug);
}

/** Normaliza e valida. `slug` no resultado é sempre o normalizado. */
export function validateSlug(raw: string, extraReserved: readonly string[] = []): SlugValidation {
  const slug = normalizeSlug(raw);
  if (!SLUG_PATTERN.test(slug)) return { kind: 'invalid', slug };
  if (isReservedSlug(slug, extraReserved)) return { kind: 'reserved', slug };
  return { kind: 'ok', slug };
}

const WORD_SUFFIXES = ['oficial', 'vip', 'achados'] as const;
const MAX_NUMERIC_SUFFIX = 99;

/** Corta a base para caber o sufixo e remove hífen que sobrar na ponta. */
function withSuffix(base: string, suffix: string): string {
  const room = SLUG_MAX_LENGTH - suffix.length;
  return base.slice(0, room).replace(/-+$/, '') + suffix;
}

/**
 * Até `limit` variações válidas, não reservadas, únicas e diferentes da base:
 * `<base>-oficial`, `<base>-vip`, `<base>-achados` (exceto palavra já contida na base), `<base>2`, `<base>3`… `isTaken` (opcional) descarta as ocupadas.
 */
export function suggestSlugs(
  base: string,
  options: {
    isTaken?: (slug: string) => boolean;
    extraReserved?: readonly string[];
    limit?: number;
  } = {},
): string[] {
  const { isTaken, extraReserved = [], limit = MAX_SLUG_SUGGESTIONS } = options;
  const root = normalizeSlug(base).replace(/[^a-z0-9-]/g, '').replace(/-+/g, '-').replace(/^-+|-+$/g, '') || 'link';
  const candidates = [
    // Palavra já contida na base vira redundância (`vip-vip`): fica de fora.
    ...WORD_SUFFIXES.filter((word) => !root.includes(word)).map((word) => withSuffix(root, `-${word}`)),
    ...Array.from({ length: MAX_NUMERIC_SUFFIX - 1 }, (_, i) => withSuffix(root, String(i + 2))),
  ];
  const out: string[] = [];
  for (const candidate of candidates) {
    if (out.length >= limit) break;
    if (candidate === root || out.includes(candidate)) continue;
    if (validateSlug(candidate, extraReserved).kind !== 'ok') continue;
    if (isTaken?.(candidate)) continue;
    out.push(candidate);
  }
  return out;
}
