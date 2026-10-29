/**
 * Lógica pura do formulário da Página de Ofertas: estado a partir do `GET`, validação espelhando a
 * API (`storefrontRules.ts`, `slugRules.ts` — a API revalida e continua dona da regra), diff,
 * troca de endereço e payloads do `PUT`/prévia. Sem React, sem HTTP.
 */
import { finalizeSlug, previewUrl } from '@/features/linkRotation/slug';
import { storefrontStrings } from './strings';
import type {
  SaveStorefrontInput,
  SlugAvailabilityStatus,
  StorefrontApiError,
  StorefrontOverview,
  StorefrontPreviewDraft,
} from './types';
import { STOREFRONT_RANGES } from './types';

const t = storefrontStrings;

/** Rascunho do formulário (vai para `usePersistedState`). `slug` como digitado. */
export interface StorefrontFormState {
  title: string;
  subtitle: string;
  slug: string;
  domainId: string;
  colorPrimary: string;
  colorBackground: string;
  colorCard: string;
  categories: string[];
}

export type StorefrontFormField = keyof StorefrontFormState;
export type StorefrontFormErrors = Partial<Record<StorefrontFormField, string>>;

/** Mesmos padrões do schema (`STOREFRONT_DEFAULT_COLORS` na API). */
export const STOREFRONT_FORM_DEFAULTS: StorefrontFormState = {
  title: '',
  subtitle: '',
  slug: '',
  domainId: '',
  colorPrimary: '#2563EB',
  colorBackground: '#F5F5F5',
  colorCard: '#FFFFFF',
  categories: [],
};

/** Formato final do nome: 3–50, a-z0-9 e hífen, sem hífen nas pontas (`SLUG_PATTERN` da API). */
const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/;
const HEX_COLOR = /^#[0-9a-f]{6}$/i;
/** Teto do schema da prévia para cor (`maxLength: 16`). */
const PREVIEW_COLOR_MAX = 16;
const COLOR_FIELDS = ['colorPrimary', 'colorBackground', 'colorCard'] as const;

/** Só `#RRGGBB` (sem atalho de 3 dígitos, sem alfa); devolve maiúsculo ou null. */
export function normalizeHexColor(raw: string): string | null {
  const value = raw.trim();
  return HEX_COLOR.test(value) ? value.toUpperCase() : null;
}

export function formFromOverview(overview: StorefrontOverview): StorefrontFormState {
  const page = overview.storefront;
  const firstDomain = overview.domains[0]?.id ?? '';
  if (!page) return { ...STOREFRONT_FORM_DEFAULTS, domainId: firstDomain };
  return {
    title: page.title,
    subtitle: page.subtitle ?? '',
    slug: page.slug ?? '',
    domainId: page.domainId ?? firstDomain,
    colorPrimary: page.colorPrimary,
    colorBackground: page.colorBackground,
    colorCard: page.colorCard,
    categories: [...page.categories],
  };
}

export function validateForm(form: StorefrontFormState): StorefrontFormErrors {
  const errors: StorefrontFormErrors = {};
  const title = form.title.trim();
  if (title.length < STOREFRONT_RANGES.name.min || title.length > STOREFRONT_RANGES.name.max) errors.title = t.fields.name.invalid;
  if (form.subtitle.trim().length > STOREFRONT_RANGES.subtitleMax) errors.subtitle = t.fields.subtitle.invalid;
  for (const field of COLOR_FIELDS) {
    if (!normalizeHexColor(form[field])) errors[field] = t.fields.colors.invalid;
  }
  if (!SLUG_PATTERN.test(finalizeSlug(form.slug))) errors.slug = t.slugStatus.INVALID;
  if (!form.domainId) errors.domainId = t.errors.LINK_DOMAIN_INVALID;
  return errors;
}

export const isFormValid = (form: StorefrontFormState): boolean => Object.keys(validateForm(form)).length === 0;

/** Corpo do `PUT /storefront`. Chamar só com o formulário válido (cor inválida segue crua e a API recusa). */
export function toSavePayload(form: StorefrontFormState): SaveStorefrontInput {
  const color = (raw: string) => normalizeHexColor(raw) ?? raw.trim();
  return {
    domainId: form.domainId,
    slug: finalizeSlug(form.slug),
    title: form.title.trim(),
    subtitle: form.subtitle.trim() || null,
    colorPrimary: color(form.colorPrimary),
    colorBackground: color(form.colorBackground),
    colorCard: color(form.colorCard),
    categories: [...form.categories],
  };
}

/**
 * Corpo da prévia: aceita rascunho inválido (a API cai no padrão), mas corta no limite para nunca
 * receber 400 do schema. Endereço só vai quando há nome e domínio.
 */
export function toPreviewDraft(form: StorefrontFormState): StorefrontPreviewDraft {
  const slug = finalizeSlug(form.slug);
  return {
    title: form.title.trim().slice(0, STOREFRONT_RANGES.name.max),
    subtitle: form.subtitle.trim().slice(0, STOREFRONT_RANGES.subtitleMax) || null,
    colorPrimary: form.colorPrimary.trim().slice(0, PREVIEW_COLOR_MAX),
    colorBackground: form.colorBackground.trim().slice(0, PREVIEW_COLOR_MAX),
    colorCard: form.colorCard.trim().slice(0, PREVIEW_COLOR_MAX),
    categories: [...form.categories],
    ...(slug ? { slug } : {}),
    ...(form.domainId ? { domainId: form.domainId } : {}),
  };
}

/**
 * O que a prévia lê do salvo e não está no rascunho: foto, capa e publicadas (ordem e edição).
 * Muda a revisão → a prévia é pedida de novo; sem isso ela fica velha após upload/publicar.
 */
export function previewRevision(overview: StorefrontOverview | null): string {
  if (!overview) return '';
  const page = overview.storefront;
  return JSON.stringify([page?.avatarUrl ?? null, page?.coverUrl ?? null, overview.offers.published.map((o) => [o.id, o.updatedAt])]);
}

const sameList = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((v, i) => v === b[i]);

/** Mudou em relação ao salvo? Sem página salva, sempre true (é uma criação). */
export function isFormDirty(form: StorefrontFormState, overview: StorefrontOverview): boolean {
  if (!overview.storefront) return true;
  const a = toSavePayload(form);
  const b = toSavePayload(formFromOverview(overview));
  return (
    a.domainId !== b.domainId ||
    a.slug !== b.slug ||
    a.title !== b.title ||
    a.subtitle !== b.subtitle ||
    COLOR_FIELDS.some((f) => a[f] !== b[f]) ||
    !sameList(a.categories, b.categories)
  );
}

/** Troca de endereço de uma página já publicada (aviso antes de salvar): URLs de/para, ou null. */
export function slugChange(form: StorefrontFormState, overview: StorefrontOverview): { from: string; to: string } | null {
  const page = overview.storefront;
  if (!page?.slug || !page.domainId) return null;
  const slug = finalizeSlug(form.slug);
  if (slug === page.slug && form.domainId === page.domainId) return null;
  const host = (id: string) => overview.domains.find((d) => d.id === id)?.hostname;
  const fromHost = host(page.domainId);
  const toHost = host(form.domainId);
  if (!fromHost || !toHost || !slug) return null;
  return { from: previewUrl(page.slug, fromHost), to: previewUrl(slug, toHost) };
}

export type SlugStatusTone = 'success' | 'info' | 'warning' | 'error';

export const SLUG_STATUSES: readonly SlugAvailabilityStatus[] = ['AVAILABLE', 'OWNED', 'TAKEN', 'RESERVED', 'PREMIUM', 'INVALID'];

const SLUG_TONES: Record<SlugAvailabilityStatus, SlugStatusTone> = {
  AVAILABLE: 'success',
  OWNED: 'success',
  TAKEN: 'error',
  RESERVED: 'error',
  PREMIUM: 'warning',
  INVALID: 'error',
};

/** Estado do campo do nome → tom (cor do helper/ícone) e texto. */
export function slugStatusView(status: SlugAvailabilityStatus): { tone: SlugStatusTone; text: string } {
  return { tone: SLUG_TONES[status], text: t.slugStatus[status] };
}

/** Códigos que a tela traduz; os demais caem no genérico. */
export const STOREFRONT_ERROR_CODES = [
  'PLAN_FEATURE_UNAVAILABLE',
  'VALIDATION_ERROR',
  'LINK_SLUG_INVALID',
  'LINK_SLUG_RESERVED',
  'LINK_SLUG_TAKEN',
  'LINK_DOMAIN_INVALID',
  'STOREFRONT_SLUG_PREMIUM',
  'STOREFRONT_OFFER_LIMIT',
  'STOREFRONT_PUBLISHED_LIMIT',
  'STOREFRONT_NOT_FOUND',
  'STOREFRONT_ORDER_INVALID',
  'OFFER_URL_UNSUPPORTED',
  'OFFER_PRODUCT_NOT_FOUND',
  'OFFER_LINK_NOT_OWNED',
  'OFFER_LINK_NOT_AFFILIATE',
  'MEDIA_TOO_LARGE',
  'UNSUPPORTED_MEDIA_TYPE',
  'MEDIA_PROCESSING_FAILED',
  'UPLOAD_NOT_FOUND',
  'UPLOAD_INCOMPLETE',
  'RATE_LIMITED',
] as const;

export type StorefrontErrorCode = (typeof STOREFRONT_ERROR_CODES)[number];

/**
 * Erro da API (ou o código) → texto pt-BR. Nunca devolve a `message` crua da API. `RATE_LIMITED`
 * usa `meta.retryAfterSeconds` quando vier.
 */
export function errorMessage(err: unknown): string {
  const e: StorefrontApiError = typeof err === 'string' ? { code: err } : ((err ?? {}) as StorefrontApiError);
  const code = (STOREFRONT_ERROR_CODES as readonly string[]).includes(e.code ?? '') ? (e.code as StorefrontErrorCode) : null;
  if (!code) return t.errors.generic;
  const seconds = e.meta?.retryAfterSeconds;
  if (code === 'RATE_LIMITED' && typeof seconds === 'number' && seconds > 0) return t.errors.rateLimitedSeconds(seconds);
  return t.errors[code];
}
