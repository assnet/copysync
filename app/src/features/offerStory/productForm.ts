/**
 * Lógica pura do passo "Produto": validação local (espelha o schema/use case da API, que revalida)
 * e tradução de erro da API → campo + texto. Sem React, sem HTTP.
 */
import { AFFILIATE_LINK_ERROR_CODES, describeAffiliateLinkError } from '@/features/affiliateLinks/linkErrors';
import { plansAbove } from '@/features/linkRotation/planUpsell';
import { isMercadoLivreTagLimit, isSheinUnavailable, planLimitOf } from '@/features/plans/planGate';
import { OFFER_STORY_RULES as R } from './productForm.rules';
import { offerStoryStrings } from './strings';
import type { OfferStoryApiError, RenderOfferStoryInput } from './types';

const t = offerStoryStrings;
const URL_MAX = 2048;

/** Campos do passo 2 (persistidos no assistente). `discount` como digitado. */
export interface ProductFormState {
  url: string;
  couponEnabled: boolean;
  code: string;
  discount: string;
}

export type ProductField = 'url' | 'code' | 'discount';
export type ProductFormErrors = Partial<Record<ProductField, string>>;

export const PRODUCT_FORM_DEFAULTS: ProductFormState = { url: '', couponEnabled: false, code: '', discount: '' };

function urlError(raw: string): string | undefined {
  const value = raw.trim();
  if (!value) return t.validation.urlRequired;
  if (value.length > URL_MAX) return t.validation.urlInvalid;
  try {
    const { protocol } = new URL(value);
    return protocol === 'https:' || protocol === 'http:' ? undefined : t.validation.urlInvalid;
  } catch {
    return t.validation.urlInvalid;
  }
}

function codeError(raw: string): string | undefined {
  const value = raw.trim();
  if (!value) return t.validation.codeRequired;
  if ([...value].length > R.couponMax) return t.validation.codeTooLong;
  return R.couponPattern.test(value) ? undefined : t.validation.codeInvalid;
}

/** '' = sem desconto; senão inteiro 1–90. */
export function parseDiscount(raw: string): number | null | undefined {
  const value = raw.trim();
  if (!value) return null;
  if (!/^\d+$/.test(value)) return undefined;
  const n = Number(value);
  return n >= R.discountMin && n <= R.discountMax ? n : undefined;
}

export function validateProductForm(form: ProductFormState): ProductFormErrors {
  const errors: ProductFormErrors = {};
  const url = urlError(form.url);
  if (url) errors.url = url;
  if (form.couponEnabled) {
    const code = codeError(form.code);
    if (code) errors.code = code;
    if (parseDiscount(form.discount) === undefined) errors.discount = t.validation.discountInvalid;
  }
  return errors;
}

export const hasErrors = (errors: ProductFormErrors) => Object.keys(errors).length > 0;

/** Payload do `POST /render`. Chame só com o formulário válido. */
export function toRenderInput(templateId: string, form: ProductFormState): RenderOfferStoryInput {
  const input: RenderOfferStoryInput = { templateId, url: form.url.trim() };
  if (form.couponEnabled) {
    const discount = parseDiscount(form.discount);
    input.coupon = { code: form.code.trim(), ...(typeof discount === 'number' ? { discountPercent: discount } : {}) };
  }
  return input;
}

/** Códigos com texto próprio do story (`strings.ts`). */
const STORY_ERROR_CODES = [
  'OFFER_URL_UNSUPPORTED',
  'OFFER_PRODUCT_NOT_FOUND',
  'OFFER_STORY_PRODUCT_INCOMPLETE',
  'OFFER_INVALID_INPUT',
  'VALIDATION_ERROR',
  'OFFER_STORY_TEMPLATE_NOT_FOUND',
  'MEDIA_PROCESSING_FAILED',
  'MEDIA_PROCESSOR_UNAVAILABLE',
  'AFFILIATE_IDENTIFIER_NOT_LINKED',
  'PLAN_LIMIT_REACHED',
  'RATE_LIMITED',
] as const;

type StoryErrorCode = (typeof STORY_ERROR_CODES)[number];

/** Tudo o que o story trata; os de link de afiliado têm texto e ação no módulo comum (`affiliateLinks`). */
export const OFFER_STORY_ERROR_CODES = [...STORY_ERROR_CODES, ...AFFILIATE_LINK_ERROR_CODES] as const;

export type OfferStoryErrorCode = (typeof OFFER_STORY_ERROR_CODES)[number];

/** Erros que ficam no campo do link (o usuário continua no passo 2). */
const URL_CODES: readonly string[] = [
  'OFFER_URL_UNSUPPORTED',
  'OFFER_PRODUCT_NOT_FOUND',
  'OFFER_STORY_PRODUCT_INCOMPLETE',
  // Credencial/API de afiliado da loja do link: a correção é no link ou nas credenciais.
  'AFFILIATE_CREDENTIAL_REQUIRED',
  'AFFILIATE_CREDENTIAL_REJECTED',
  'AFFILIATE_API_ACCESS_DENIED',
  'MARKETPLACE_RISK_NOT_ACCEPTED',
  'OFFER_LINK_REBUILD_FAILED',
  // Etiqueta da conta do ML não vinculada: vincular nas credenciais
  'AFFILIATE_IDENTIFIER_NOT_LINKED',
];

/** `field` da API → campo do formulário (`coupon`/`coupon.code` → código). */
function fieldOf(apiField: string | undefined): ProductField | null {
  if (!apiField) return null;
  if (apiField === 'url') return 'url';
  if (apiField.includes('discount')) return 'discount';
  if (apiField.startsWith('coupon')) return 'code';
  return null;
}

export interface OfferStoryErrorView {
  /** Campo que recebe a mensagem; null = aviso geral do passo. */
  field: ProductField | null;
  message: string;
  /** Template sumiu do catálogo: volta ao passo 1. */
  backToTemplates: boolean;
  /** Correção em outra tela (botão sob o link). Ausente = sem ação. */
  action?: OfferStoryErrorAction;
  /** Erro de credencial do módulo comum: código e `meta` do botão de conectar a loja. */
  connect?: OfferStoryConnectError;
}

export interface OfferStoryConnectError {
  code: string;
  meta?: unknown;
}

/** O que o passo do produto oferece sob o link além do texto do erro. */
export type OfferStoryErrorAction = 'credentials' | 'plans';

/** Erro da API → texto pt-BR e onde mostrar. Nunca usa a `message` crua da API. */
export function mapRenderError(err: unknown): OfferStoryErrorView {
  const e = (err ?? {}) as OfferStoryApiError;
  if (isSheinUnavailable(e)) return { field: 'url', message: t.errors.sheinUnavailable, backToTemplates: false };
  // Etiqueta da conta do ML sem vaga: planos; no maior plano, credenciais para desvincular outra
  if (isMercadoLivreTagLimit(e)) {
    const limit = planLimitOf(e);
    const canUpgrade = limit == null || plansAbove('mercadoLivreTags', limit).length > 0;
    return { field: 'url', message: t.errors.mercadoLivreTagLimit(limit, canUpgrade), backToTemplates: false, action: canUpgrade ? 'plans' : 'credentials' };
  }
  if (e.code === 'AFFILIATE_IDENTIFIER_NOT_LINKED') {
    return { field: 'url', message: t.errors.AFFILIATE_IDENTIFIER_NOT_LINKED, backToTemplates: false, action: 'credentials' };
  }
  const shared = describeAffiliateLinkError(e.code, e.meta);
  if (shared) {
    const view: OfferStoryErrorView = { field: URL_CODES.includes(e.code!) ? 'url' : null, message: shared.message, backToTemplates: false };
    return shared.action === 'credentials' ? { ...view, action: 'credentials', connect: { code: e.code!, meta: e.meta } } : view;
  }
  const code = (STORY_ERROR_CODES as readonly string[]).includes(e.code ?? '') ? (e.code as StoryErrorCode) : null;
  if (!code) return { field: null, message: t.errors.generic, backToTemplates: false };
  if (URL_CODES.includes(code)) return { field: 'url', message: t.errors[code], backToTemplates: false };
  if (code === 'OFFER_INVALID_INPUT' || code === 'VALIDATION_ERROR') {
    const field = fieldOf(e.field);
    const message = field === 'code' ? t.validation.codeInvalid : field === 'discount' ? t.validation.discountInvalid : field === 'url' ? t.validation.urlInvalid : t.errors[code];
    return { field, message, backToTemplates: false };
  }
  if (code === 'RATE_LIMITED') {
    const seconds = e.meta?.retryAfterSeconds;
    const message = typeof seconds === 'number' && seconds > 0 ? t.errors.rateLimitedSeconds(seconds) : t.errors.RATE_LIMITED;
    return { field: null, message, backToTemplates: false };
  }
  return { field: null, message: t.errors[code], backToTemplates: code === 'OFFER_STORY_TEMPLATE_NOT_FOUND' };
}
