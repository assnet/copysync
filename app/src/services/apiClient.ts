import axios, { AxiosHeaders, type AxiosError, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios';
import { recordServerTime } from './serverClock';

type ApiErrorPayload = {
  error?: { message?: string; code?: string; meta?: { field?: string } & Record<string, unknown> };
  message?: string;
};

type RetryableRequestConfig = InternalAxiosRequestConfig & {
  _retry?: boolean;
};

type RefreshTokenResult =
  | { status: 'success'; accessToken: string }
  | { status: 'invalid' }
  | { status: 'unavailable'; message: string }
  | { status: 'failed'; message: string; httpStatus?: number };

const apiBaseURL = import.meta.env.VITE_API_URL ?? 'http://localhost:3000/api';

let refreshPromise: Promise<RefreshTokenResult> | null = null;

export const apiClient = axios.create({
  baseURL: apiBaseURL,
  headers: { 'Content-Type': 'application/json' },
});

const refreshClient = axios.create({
  baseURL: apiBaseURL,
  headers: { 'Content-Type': 'application/json' },
});

function clearSessionAndRedirect(): void {
  localStorage.removeItem('accessToken');
  localStorage.removeItem('refreshToken');
  localStorage.removeItem('authUser');
  localStorage.removeItem('activeTenantId');
  localStorage.removeItem('activeTenantName');

  if (!window.location.pathname.startsWith('/login')) {
    window.location.href = '/login';
  }
}

// Tenant suspenso/cancelado: a tela de assinatura é a única que a API ainda serve
// (SUB-02). Redireciona uma vez por carga de página, nunca a partir da própria tela,
// e sem limpar a sessão: o usuário precisa continuar logado para regularizar.
export const SUBSCRIPTION_PATH = '/settings/subscription';
let suspendedRedirectStarted = false;

function redirectToSubscription(): void {
  if (suspendedRedirectStarted) return;
  if (window.location.pathname.startsWith(SUBSCRIPTION_PATH)) return;
  suspendedRedirectStarted = true;
  window.location.href = `${SUBSCRIPTION_PATH}?suspended=1`;
}

function getErrorMessage(error: AxiosError<ApiErrorPayload>): string {
  return (
    error.response?.data?.error?.message ??
    error.response?.data?.message ??
    error.message ??
    'Erro inesperado'
  );
}

/** Status de proxy/gateway que a Render devolve enquanto a API sobe ou troca de instância (deploy). */
const SERVICE_UNAVAILABLE_STATUSES: ReadonlySet<number> = new Set([502, 503, 504]);

/** Sem resposta que não é falha de rede/proxy: cancelada ou timeout (servidor vivo e lento). */
const NOT_UNAVAILABLE_CODES: ReadonlySet<string> = new Set(['ERR_CANCELED', 'ECONNABORTED', 'ETIMEDOUT']);

/**
 * Indisponibilidade passageira (deploy, reinício): falha de rede/proxy sem resposta ou 502/503/504.
 * 500 e 4xx não entram (erro da requisição/da API, não serviço fora do ar); cancelada e timeout
 * também não.
 */
export function classifyServiceUnavailable(error: Pick<AxiosError, 'response' | 'code'>): boolean {
  if (!error.response) return !NOT_UNAVAILABLE_CODES.has(error.code ?? '');
  return SERVICE_UNAVAILABLE_STATUSES.has(error.response.status);
}

/** Status do `/auth/refresh` que é passageiro: indisponível, sem logout. */
const REFRESH_TRANSIENT_STATUSES: ReadonlySet<number> = new Set([408, 429, 502, 503, 504]);

/**
 * Refresh recusado de vez: token inválido (400/401) ou usuário removido (404). 403 fica de fora: a
 * API nunca o devolve no `/auth/refresh`, então ali é proxy/WAF, e falha de infra não desloga.
 */
const REFRESH_INVALID_STATUSES: ReadonlySet<number> = new Set([400, 401, 404]);

/**
 * Resultado de uma falha do `/auth/refresh`:
 * - `invalid` (desloga): 400, 401, 404.
 * - `unavailable` (estado "atualizando", sem logout): rede/proxy sem resposta, 408, 429, 502–504.
 * - `failed` (erro comum, sem logout): 403 (proxy/WAF), 500 e outros 5xx, timeout, erro fora do HTTP.
 */
export function classifyRefreshFailure(err: unknown): RefreshTokenResult {
  const message = err instanceof Error && err.message ? err.message : 'Erro inesperado';
  if (!axios.isAxiosError(err)) return { status: 'failed', message };
  const status = err.response?.status;
  if (status !== undefined && REFRESH_INVALID_STATUSES.has(status)) return { status: 'invalid' };
  if (status === undefined ? classifyServiceUnavailable(err) : REFRESH_TRANSIENT_STATUSES.has(status)) {
    return { status: 'unavailable', message };
  }
  return { status: 'failed', message, httpStatus: status };
}

/** O erro rejeitado pelo `apiClient` é de serviço temporariamente indisponível? */
export function isServiceUnavailable(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { serviceUnavailable?: unknown }).serviceUnavailable === true;
}

async function refreshAccessToken(): Promise<RefreshTokenResult> {
  const refreshToken = localStorage.getItem('refreshToken');
  if (!refreshToken) {
    return { status: 'invalid' };
  }

  if (!refreshPromise) {
    refreshPromise = refreshClient
      .post<{ success: true; data: { accessToken: string } }>('/auth/refresh', {
        refreshToken,
      })
      .then((response): RefreshTokenResult => {
        // Corpo fora do contrato não é indisponibilidade nem token inválido: erro comum.
        const accessToken: unknown = response.data?.data?.accessToken;
        if (typeof accessToken !== 'string' || accessToken === '') {
          return { status: 'failed', message: 'Resposta inválida do refresh', httpStatus: response.status };
        }
        localStorage.setItem('accessToken', accessToken);
        return { status: 'success', accessToken };
      }, classifyRefreshFailure)
      // Erro ao gravar o token (ex.: storage bloqueado) também vira `failed`, nunca rejeição solta.
      .catch(classifyRefreshFailure)
      .finally(() => {
        refreshPromise = null;
      });
  }

  return refreshPromise;
}

/** Repete a requisição com o token dado (e o tenant atual). */
function retryWithToken(request: RetryableRequestConfig, accessToken: string) {
  const headers = AxiosHeaders.from(request.headers);
  headers.set('Authorization', `Bearer ${accessToken}`);
  const tenantId = localStorage.getItem('activeTenantId');
  if (tenantId) headers.set('x-tenant-id', tenantId);
  request.headers = headers;
  return apiClient(request);
}

// ── Request interceptor — injeta token e tenant ─────────────────────────────
// Instante de saída por request, para estimar o relógio do servidor (ver serverClock.ts).
const sentAt = new WeakMap<object, number>();

function sampleServerClock(response: AxiosResponse | undefined): void {
  if (!response) return;
  const header = response.headers?.['x-server-time'];
  const started = sentAt.get(response.config);
  if (header !== undefined && started !== undefined) recordServerTime(Number(header), started, Date.now());
}

apiClient.interceptors.request.use((config) => {
  sentAt.set(config, Date.now());
  const token = localStorage.getItem('accessToken');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }

  const tenantId = localStorage.getItem('activeTenantId');
  if (tenantId) {
    config.headers['x-tenant-id'] = tenantId;
  }

  return config;
});

// ── Response interceptor — normaliza erros ──────────────────────────────────
apiClient.interceptors.response.use(
  (response) => {
    sampleServerClock(response);
    return response;
  },
  async (error: AxiosError<ApiErrorPayload>) => {
    sampleServerClock(error.response);
    const originalRequest = error.config as RetryableRequestConfig | undefined;
    const requestUrl = originalRequest?.url ?? '';
    // Inclui o passo do código (/auth/login/verify|resend): 401/400 ali nunca tenta refresh.
    const isAuthLogin = /\/auth\/login(\/(verify|resend))?$/.test(requestUrl);
    const isAuthRefresh = requestUrl.endsWith('/auth/refresh');
    // Senha digitada errada numa confirmação (ex.: excluir a Página de Ofertas): o token segue
    // válido. Sem refresh, sem repetir o pedido (gastaria outra tentativa) e sem logout.
    const isWrongPassword = error.response?.status === 401 && error.response.data?.error?.code === 'INVALID_CREDENTIALS';

    if (
      error.response?.status === 401 &&
      originalRequest &&
      !originalRequest._retry &&
      !isAuthLogin &&
      !isAuthRefresh &&
      !isWrongPassword
    ) {
      originalRequest._retry = true;

      // 401 tardio: outro pedido já renovou o token depois que este saiu. Repete com o atual,
      // sem refazer o `/auth/refresh`.
      const current = localStorage.getItem('accessToken');
      const sent = AxiosHeaders.from(originalRequest.headers).get('Authorization');
      if (current && sent !== `Bearer ${current}`) {
        return retryWithToken(originalRequest, current);
      }

      const result = await refreshAccessToken();
      if (result.status === 'success') return retryWithToken(originalRequest, result.accessToken);
      // Refresh indisponível (deploy) ou com falha que não diz que o token é inválido: o refresh
      // token segue valendo. Não desloga; a tela tenta de novo e o 401 → refresh roda outra vez.
      // Só `invalid` (refresh 400/401, sem token) cai no logout abaixo.
      if (result.status === 'unavailable') {
        return Promise.reject(Object.assign(new Error(result.message), {
          status: undefined, code: 'SERVICE_UNAVAILABLE', serviceUnavailable: true,
        }));
      }
      if (result.status === 'failed') {
        return Promise.reject(Object.assign(new Error(result.message), {
          status: result.httpStatus, code: 'REFRESH_FAILED', serviceUnavailable: false,
        }));
      }
    }

    if (error.response?.status === 401 && !isWrongPassword) {
      clearSessionAndRedirect();
    }

    if (error.response?.data?.error?.code === 'TENANT_SUSPENDED') {
      redirectToSubscription();
    }

    // Tenant inválido (banco trocado, ID antigo no localStorage) → sessão morta
    if (error.response?.status === 403) {
      const msg = String(
        (error.response.data as { error?: { message?: string } })?.error?.message ?? '',
      );
      if (msg.includes('Tenant not found') || msg.includes('do not have access')) {
        clearSessionAndRedirect();
      }
    }

    // `status`/`code` seguem junto para quem precisa distinguir o erro (ex.: 429 × 409);
    // `field` aponta o campo recusado num 422, para o formulário marcar.
    return Promise.reject(
      Object.assign(new Error(getErrorMessage(error)), {
        status: error.response?.status,
        code: error.response?.data?.error?.code,
        field: error.response?.data?.error?.meta?.field,
        // Dados extras do erro (ex.: `limit` do PLAN_LIMIT_REACHED); nunca carrega segredo.
        meta: error.response?.data?.error?.meta,
        // `Retry-After` de um 429 (segundos ou data HTTP), para a tela dizer quando tentar de novo.
        retryAfter: error.response?.headers?.['retry-after'],
        // Rede/502/503/504: a tela mostra "Estamos atualizando o sistema" (ver `isServiceUnavailable`).
        serviceUnavailable: classifyServiceUnavailable(error),
      }),
    );
  },
);
