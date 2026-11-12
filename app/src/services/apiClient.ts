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
  | { status: 'unavailable'; message: string };

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

/**
 * Indisponibilidade passageira (deploy, reinício): sem resposta (rede) ou 502/503/504. 500 e
 * 4xx não entram: são erro da requisição/da API, não do serviço fora do ar. Cancelada não conta.
 */
export function classifyServiceUnavailable(error: Pick<AxiosError, 'response' | 'code'>): boolean {
  if (error.code === 'ERR_CANCELED') return false;
  if (!error.response) return true;
  return SERVICE_UNAVAILABLE_STATUSES.has(error.response.status);
}

/** O erro rejeitado pelo `apiClient` é de serviço temporariamente indisponível? */
export function isServiceUnavailable(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { serviceUnavailable?: unknown }).serviceUnavailable === true;
}

async function refreshAccessToken(): Promise<string | null> {
  const refreshToken = localStorage.getItem('refreshToken');
  if (!refreshToken) {
    return null;
  }

  if (!refreshPromise) {
    refreshPromise = refreshClient
      .post<{ success: true; data: { accessToken: string } }>('/auth/refresh', {
        refreshToken,
      })
      .then((response) => {
        const accessToken = response.data.data.accessToken;
        localStorage.setItem('accessToken', accessToken);
        return { status: 'success', accessToken } as const;
      })
      .catch((err: unknown) => {
        const axiosError = err as AxiosError<ApiErrorPayload>;
        if (!axiosError.response || axiosError.response.status >= 500) {
          return {
            status: 'unavailable',
            message: err instanceof Error ? err.message : 'Erro inesperado',
          } as const;
        }

        return { status: 'invalid' } as const;
      })
      .finally(() => {
        refreshPromise = null;
      });
  }

  const result = await refreshPromise;

  if (result.status === 'success') {
    return result.accessToken;
  }

  if (result.status === 'invalid') {
    return null;
  }

  throw new Error(result.message);
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

    if (
      error.response?.status === 401 &&
      originalRequest &&
      !originalRequest._retry &&
      !isAuthLogin &&
      !isAuthRefresh
    ) {
      originalRequest._retry = true;

      try {
        const accessToken = await refreshAccessToken();
        if (accessToken) {
          const headers = AxiosHeaders.from(originalRequest.headers);
          headers.set('Authorization', `Bearer ${accessToken}`);

          const tenantId = localStorage.getItem('activeTenantId');
          if (tenantId) {
            headers.set('x-tenant-id', tenantId);
          }

          originalRequest.headers = headers;
          return apiClient(originalRequest);
        }
      } catch (refreshError) {
        // `/auth/refresh` sem resposta ou 5xx (deploy): o refresh token segue válido. Não desloga;
        // rejeita como indisponível e a tela tenta de novo depois (o 401 → refresh roda outra vez).
        // Só `invalid` (refresh 400/401, sem token) cai no logout abaixo.
        return Promise.reject(
          Object.assign(new Error(refreshError instanceof Error ? refreshError.message : 'Serviço indisponível'), {
            status: undefined,
            code: 'SERVICE_UNAVAILABLE',
            serviceUnavailable: true,
          }),
        );
      }
    }

    if (error.response?.status === 401) {
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
