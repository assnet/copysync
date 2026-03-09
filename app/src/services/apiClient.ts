import axios, { type AxiosError } from 'axios';

export const apiClient = axios.create({
  baseURL: import.meta.env.VITE_API_URL ?? 'http://localhost:3000/api',
  headers: { 'Content-Type': 'application/json' },
});

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
  (error: AxiosError<{ error?: { message?: string }; message?: string }>) => {
    const msg =
      error.response?.data?.error?.message ??
      error.response?.data?.message ??
      error.message ??
      'Erro inesperado';
    return Promise.reject(new Error(msg));
  },
);
