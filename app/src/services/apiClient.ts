import axios, { AxiosHeaders, type AxiosError, type InternalAxiosRequestConfig } from 'axios';

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

function getErrorMessage(error: AxiosError<ApiErrorPayload>): string {
  return (
    error.response?.data?.error?.message ??
    error.response?.data?.message ??
    error.message ??
    'Erro inesperado'
  );
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
apiClient.interceptors.request.use((config) => {
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
  (response) => response,
  async (error: AxiosError<ApiErrorPayload>) => {
    const originalRequest = error.config as RetryableRequestConfig | undefined;
    const requestUrl = originalRequest?.url ?? '';
    const isAuthLogin = requestUrl.endsWith('/auth/login');
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
      } catch {
        // refresh falhou com erro inesperado — trata como sessão inválida
      }
    }

    if (error.response?.status === 401) {
      clearSessionAndRedirect();
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
      }),
    );
  },
);
