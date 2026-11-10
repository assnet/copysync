import { env } from '../config/env.js';
import { devLog } from '../core/devLog.js';
import { SyncError } from './errors.js';
import { getInstallationId, type SyncErrorCode } from './store.js';

/**
 * HTTP client for the CopySync API using cookie-based auth.
 *
 * All extension routes use `credentials:'include'` (cookie `__Host-ext_session`).
 * Bearer auth is gone — session lives in HttpOnly cookie set by `POST /session`.
 *
 * Headers: `X-Client: extension`, `X-Installation-Id: <uuid>`.
 */

const assertSecureApiUrl = (): void => {
  let protocol = '';
  try {
    protocol = new URL(env.apiUrl).protocol;
  } catch {
    throw new SyncError('api_unreachable', 'API_URL invalid');
  }
  if (protocol === 'https:') return;
  if (protocol === 'http:' && env.isDev) return;
  throw new SyncError('api_unreachable', `protocol not allowed: ${protocol}`);
};

const buildUrl = (path: string): string => {
  assertSecureApiUrl();
  const base = env.apiUrl.replace(/\/api\/?$/, '');
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${base}${p}`;
};

const FETCH_TIMEOUT_MS = 10_000;

/** `error.code` do envelope 403 → `SyncErrorCode`. Código desconhecido continua `forbidden`. */
const FORBIDDEN_CODES: Record<string, SyncErrorCode> = {
  ML_CONSENT_REQUIRED: 'consent_required',
  SHEIN_CONSENT_REQUIRED: 'consent_required',
  PLAN_FEATURE_UNAVAILABLE: 'plan_unavailable',
  EXTENSION_NOT_ENTITLED: 'plan_unavailable',
  MARKETPLACE_RISK_NOT_ACCEPTED: 'risk_not_accepted',
};

export const forbiddenKind = (code: string | undefined): SyncErrorCode =>
  (code && FORBIDDEN_CODES[code]) || 'forbidden';

export interface ApiEnvelope<T> {
  success: boolean;
  data: T;
  error?: { code?: string; message?: string };
}

export interface ApiFetchOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  path: string;
  body?: unknown;
  /** Default `FETCH_TIMEOUT_MS`. */
  timeoutMs?: number;
}

export const apiFetch = async <T>(opts: ApiFetchOptions): Promise<T> => {
  const installationId = await getInstallationId();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'X-Client': 'extension',
  };
  if (installationId) headers['X-Installation-Id'] = installationId;

  let response: Response;
  try {
    response = await fetch(buildUrl(opts.path), {
      method: opts.method ?? 'GET',
      headers,
      credentials: 'include',
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: AbortSignal.timeout(opts.timeoutMs ?? FETCH_TIMEOUT_MS),
    });
  } catch (error) {
    throw new SyncError('api_unreachable', error instanceof Error ? error.message : String(error));
  }

  if (response.status === 401) throw new SyncError('session_expired');
  if (response.status === 404) throw new SyncError('api_route_missing');
  if (response.status === 429) throw new SyncError('rate_limited');

  let envelope: ApiEnvelope<T> | null = null;
  try {
    envelope = (await response.json()) as ApiEnvelope<T>;
  } catch {
    envelope = null;
  }

  // 403: o `error.code` do envelope diz o motivo (consentimento, plano, aceite de risco).
  if (response.status === 403) {
    const code = envelope?.error?.code;
    throw new SyncError(forbiddenKind(code), code ? `HTTP 403 ${code}` : undefined);
  }

  if (!response.ok || !envelope?.success) {
    const code = envelope?.error?.code ?? '';
    const detail = `HTTP ${response.status}${code ? ` ${code}` : ''}`;
    devLog('api error', opts.method ?? 'GET', opts.path, detail);
    throw new SyncError('api_rejected', detail);
  }

  return envelope.data;
};
