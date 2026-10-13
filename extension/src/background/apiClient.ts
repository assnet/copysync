import { AFFILIATE_PROVIDER, env } from '../config/env.js';
import type {
  AffiliateSessionSyncRequest,
  AffiliateSessionSyncResponse,
  ApiEnvelope,
  LoginResponse,
  RefreshResponse,
} from '../contract/api.js';
import type { StoredAuth, SyncErrorCode } from '../contract/messages.js';
import { devLog } from '../core/devLog.js';
import { applyRenewedAccessToken, clearAuth } from './authStore.js';
import { SyncError } from './errors.js';

/**
 * Cliente HTTP da API. ÚNICO lugar que monta URL (`env.apiUrl` + path).
 * Nenhum texto da API sobe para o popup: todo erro vira `SyncError` com
 * `SyncErrorCode` (mesmo princípio de AGENTS.md §13 — tradução de erros).
 */
type Method = 'GET' | 'POST' | 'PUT';

interface RequestOptions {
  method: Method;
  path: string;
  body?: unknown;
  auth?: { accessToken: string; tenantId: string };
  /** Código usado para 401 (login usa `login_invalid`; o resto `api_unauthorized`). */
  unauthorizedCode?: SyncErrorCode;
}

/**
 * Tokens e o cookie de sessão do marketplace trafegam no corpo: só `https:`
 * em produção. `http:` é aceito apenas no build DEV (API local).
 */
const assertSecureApiUrl = (): void => {
  let protocol = '';
  try {
    protocol = new URL(env.apiUrl).protocol;
  } catch {
    throw new SyncError('api_unreachable', 'API_URL inválida');
  }
  if (protocol === 'https:') return;
  if (protocol === 'http:' && env.isDev) return;
  throw new SyncError('api_unreachable', `API_URL com protocolo não permitido: ${protocol}`);
};

const buildUrl = (path: string): string => {
  assertSecureApiUrl();
  return `${env.apiUrl}${path.startsWith('/') ? path : `/${path}`}`;
};

const codeForStatus = (status: number, unauthorizedCode: SyncErrorCode): SyncErrorCode => {
  if (status === 401) return unauthorizedCode;
  if (status === 404) return 'api_route_missing';
  return 'api_rejected';
};

const request = async <T>(opts: RequestOptions): Promise<T> => {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (opts.auth) {
    headers.Authorization = `Bearer ${opts.auth.accessToken}`;
    headers['X-Tenant-Id'] = opts.auth.tenantId;
  }

  let response: Response;
  try {
    response = await fetch(buildUrl(opts.path), {
      method: opts.method,
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    });
  } catch (error) {
    throw new SyncError('api_unreachable', error instanceof Error ? error.message : String(error));
  }

  let envelope: ApiEnvelope<T> | null = null;
  try {
    envelope = (await response.json()) as ApiEnvelope<T>;
  } catch {
    envelope = null;
  }

  if (!response.ok || !envelope?.success) {
    const detail = `HTTP ${response.status}${envelope?.error?.code ? ` ${envelope.error.code}` : ''}`;
    devLog('api error', opts.method, opts.path, detail);
    throw new SyncError(codeForStatus(response.status, opts.unauthorizedCode ?? 'api_unauthorized'), detail);
  }

  return envelope.data;
};

export const login = (email: string, password: string): Promise<LoginResponse> =>
  request<LoginResponse>({
    method: 'POST',
    path: '/auth/login',
    body: { email, password },
    unauthorizedCode: 'login_invalid',
  });

export const refresh = (refreshToken: string): Promise<RefreshResponse> =>
  request<RefreshResponse>({ method: 'POST', path: '/auth/refresh', body: { refreshToken } });

/** Revoga o refresh token no servidor. Best-effort: "sair" nunca falha por rede. */
export const logout = async (auth: StoredAuth): Promise<void> => {
  try {
    await request<null>({
      method: 'POST',
      path: '/auth/logout',
      body: { refreshToken: auth.refreshToken },
      auth: { accessToken: auth.accessToken, tenantId: auth.tenantId },
    });
  } catch (error) {
    devLog('logout revoke skipped', error instanceof SyncError ? error.code : String(error));
  }
};

/**
 * Executa uma chamada autenticada. Em 401 tenta UM refresh, persiste o novo
 * access token e repete.
 *
 * - Refresh recusado (401): a sessão acabou → limpa a auth, `api_unauthorized`
 *   (o popup volta para o login).
 * - Refresh falhou por rede/5xx/404: a sessão PODE estar viva → não limpa nada,
 *   propaga o erro original do refresh.
 * - Logout ou troca de tenant durante a chamada: `applyRenewedAccessToken`
 *   recusa a gravação e a operação é abortada como `not_authenticated`.
 */
const withAuthRetry = async <T>(auth: StoredAuth, run: (current: StoredAuth) => Promise<T>): Promise<T> => {
  try {
    return await run(auth);
  } catch (error) {
    if (!(error instanceof SyncError) || error.code !== 'api_unauthorized') throw error;
  }

  let accessToken: string;
  try {
    ({ accessToken } = await refresh(auth.refreshToken));
  } catch (error) {
    const syncError = error instanceof SyncError ? error : new SyncError('api_unreachable');
    if (syncError.code === 'api_unauthorized') await clearAuth();
    throw syncError;
  }

  const renewed = await applyRenewedAccessToken(auth.refreshToken, accessToken);
  if (!renewed) throw new SyncError('not_authenticated', 'auth changed during request');
  return run(renewed);
};

export const syncAffiliateSession = (
  auth: StoredAuth,
  body: AffiliateSessionSyncRequest,
): Promise<AffiliateSessionSyncResponse> =>
  withAuthRetry(auth, (current) =>
    request<AffiliateSessionSyncResponse>({
      method: 'PUT',
      path: `/integrations/affiliate-credentials/${AFFILIATE_PROVIDER}/session`,
      body,
      auth: { accessToken: current.accessToken, tenantId: current.tenantId },
    }),
  );
