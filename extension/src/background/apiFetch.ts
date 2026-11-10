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
const FORBIDDEN_CODES: ReadonlyMap<string, SyncErrorCode> = new Map([
  ['ML_CONSENT_REQUIRED', 'consent_required'],
  ['SHEIN_CONSENT_REQUIRED', 'consent_required'],
  ['PLAN_FEATURE_UNAVAILABLE', 'plan_unavailable'],
  ['EXTENSION_NOT_ENTITLED', 'plan_unavailable'],
  ['MARKETPLACE_RISK_NOT_ACCEPTED', 'risk_not_accepted'],
]);

/**
 * `error.code` conhecido → `SyncErrorCode`, ANTES do status. Os de `FORBIDDEN_CODES` (que levam
 * `syncSession` a pausar e até remover a permissão de host) só valem em 4xx: um 5xx com o mesmo
 * código é falha do servidor e cai em `api_rejected` (só mensagem). `SESSION_NOT_FOUND` fica de
 * fora de propósito: o 404 dele no ML sempre foi `api_route_missing`. Map: sem herança de
 * `Object.prototype` (`constructor`, `__proto__` não viram código).
 */
const KNOWN_CODES: ReadonlyMap<string, SyncErrorCode> = new Map<string, SyncErrorCode>([
  ['MISSING_EXT_SESSION', 'session_expired'],
  ['INVALID_EXT_SESSION', 'session_expired'],
  ['RATE_LIMITED', 'rate_limited'],
]);

export const forbiddenKind = (code: string | undefined): SyncErrorCode =>
  (code !== undefined && FORBIDDEN_CODES.get(code)) || 'forbidden';

/** Status sem `error.code` conhecido. */
const STATUS_CODES: ReadonlyMap<number, SyncErrorCode> = new Map<number, SyncErrorCode>([
  [401, 'session_expired'],
  [403, 'forbidden'],
  [404, 'api_route_missing'],
  [429, 'rate_limited'],
]);

const envelopeCode = (envelope: unknown): string | undefined => {
  if (!envelope || typeof envelope !== 'object') return undefined;
  const error = (envelope as { error?: unknown }).error;
  if (!error || typeof error !== 'object') return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' && code ? code : undefined;
};

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

  // Envelope primeiro: o `error.code` diz o motivo (consentimento, plano, sessão); status só sem código conhecido.
  let envelope: ApiEnvelope<T> | null = null;
  try {
    envelope = (await response.json()) as ApiEnvelope<T>;
  } catch {
    envelope = null;
  }

  if (!response.ok) {
    const code = envelopeCode(envelope);
    const detail = `HTTP ${response.status}${code ? ` ${code}` : ''}`;
    const clientError = response.status >= 400 && response.status < 500;
    const known = code === undefined
      ? undefined
      : (clientError ? FORBIDDEN_CODES.get(code) : undefined) ?? KNOWN_CODES.get(code);
    const kind = known ?? STATUS_CODES.get(response.status);
    if (kind) throw new SyncError(kind, code ? detail : undefined);
  }

  if (!response.ok || !envelope?.success) {
    const code = envelopeCode(envelope) ?? '';
    const detail = `HTTP ${response.status}${code ? ` ${code}` : ''}`;
    devLog('api error', opts.method ?? 'GET', opts.path, detail);
    throw new SyncError('api_rejected', detail);
  }

  return envelope.data;
};
