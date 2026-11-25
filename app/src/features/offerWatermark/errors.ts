import { isOfferWatermarkUnavailable } from '@/features/plans/planGate';
import { offerWatermarkStrings as t } from './strings';

interface ApiErrorLike { status?: number; code?: string; field?: string; meta?: { field?: unknown } | null }

const asError = (err: unknown): ApiErrorLike => (typeof err === 'object' && err !== null ? (err as ApiErrorLike) : {});

/** 403 de plano do próprio recurso (outra chave não conta). */
export const isWatermarkPlanLocked = isOfferWatermarkUnavailable;

/** 404: fora da audiência (a flag mudou com a tela aberta). */
export const isWatermarkHidden = (err: unknown): boolean => asError(err).status === 404;

type LogoErrorCode = Exclude<keyof typeof t.logo.errors, 'generic' | 'removeFailed'>;

/** Mensagem do envio do logo (413/415/422 de mídia e erros do upload). */
export function logoErrorMessage(err: unknown): string {
  const code = asError(err).code;
  if (code && code in t.logo.errors && code !== 'generic' && code !== 'removeFailed') return t.logo.errors[code as LogoErrorCode];
  if (code === 'FORBIDDEN') return t.errors.forbidden;
  return t.logo.errors.generic;
}

/** Mensagem do salvar (422 com `meta.field`, 403 de papel). */
export function saveErrorMessage(err: unknown): string {
  const e = asError(err);
  if (e.code === 'OFFER_WATERMARK_INVALID_INPUT') {
    const field = typeof e.meta?.field === 'string' ? e.meta.field : e.field;
    return (field && t.errors.invalidField[field]) || t.errors.generic;
  }
  if (e.code === 'FORBIDDEN') return t.errors.forbidden;
  return t.errors.generic;
}
