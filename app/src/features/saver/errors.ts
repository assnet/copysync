import { saverStrings as s } from './strings';

/** O que a tela faz com o erro: faixa de limite, atalho para reconectar, aviso de canal… */
export type SaverErrorKind =
  | 'productUnavailable'
  | 'limitReached'
  | 'forbidden'
  | 'sessionNotConnected'
  | 'unsupportedChannel'
  | 'exportEmpty'
  | 'serviceUnavailable'
  | 'other';

export interface SaverError {
  kind: SaverErrorKind;
  code: string | null;
  message: string;
  /** Só em `limitReached`: chave e teto vindos de `meta`. */
  limitKey?: string;
  limit?: number;
}

type ApiErr = { code?: unknown; status?: unknown; meta?: Record<string, unknown>; serviceUnavailable?: unknown } | null;

const KIND_BY_CODE: Readonly<Record<string, SaverErrorKind>> = {
  PRODUCT_UNAVAILABLE: 'productUnavailable',
  SAVER_UNAVAILABLE: 'productUnavailable',
  PLAN_LIMIT_REACHED: 'limitReached',
  FORBIDDEN: 'forbidden',
  SESSION_NOT_CONNECTED: 'sessionNotConnected',
  ENGINE_OPERATION_UNSUPPORTED: 'unsupportedChannel',
};

/**
 * Traduz o erro rejeitado pelo `apiClient` (com `code`, `status`, `meta`). Resposta de arquivo
 * (`responseType: 'blob'`) chega sem `code`: aí decide o `status` (422 = vazio, 403 = sem permissão).
 */
export function describeSaverError(err: unknown): SaverError {
  const e = (err && typeof err === 'object' ? err : null) as ApiErr;
  const code = typeof e?.code === 'string' ? e.code : null;
  const status = typeof e?.status === 'number' ? e.status : null;

  if (e?.serviceUnavailable === true) return { kind: 'serviceUnavailable', code, message: s.errors.SERVICE_UNAVAILABLE! };

  if (code === 'PLAN_LIMIT_REACHED') {
    const limitKey = typeof e?.meta?.key === 'string' ? e.meta.key : undefined;
    const limit = typeof e?.meta?.limit === 'number' ? e.meta.limit : undefined;
    const what = limitKey ? s.limitKeys[limitKey] : undefined;
    const message = what && limit !== undefined ? s.limitReached(what, limit) : s.errors.PLAN_LIMIT_REACHED!;
    return { kind: 'limitReached', code, message, limitKey, limit };
  }

  const kind = code ? KIND_BY_CODE[code] : undefined;
  if (kind) return { kind, code, message: s.errors[code!] ?? s.errors.generic! };

  if (!code && status === 422) return { kind: 'exportEmpty', code, message: s.errors.EXPORT_EMPTY! };
  if (!code && status === 403) return { kind: 'forbidden', code, message: s.errors.FORBIDDEN! };

  return { kind: 'other', code, message: (code && s.errors[code]) || s.errors.generic! };
}

export function saverErrorMessage(err: unknown): string {
  return describeSaverError(err).message;
}
