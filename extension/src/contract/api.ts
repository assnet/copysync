/**
 * Contrato HTTP com a API (`api/`). Espelha os presenters do backend; a
 * extensão nunca monta URL fora de `background/apiClient.ts`.
 *
 * Rotas usadas:
 *   POST {API_URL}/auth/login                                  → LoginResponse
 *   POST {API_URL}/auth/refresh                                → { accessToken }
 *   PUT  {API_URL}/integrations/affiliate-credentials/MERCADO_LIVRE/session
 *        headers: Authorization: Bearer, X-Tenant-Id            → AffiliateSessionSyncResponse
 *
 * A rota PUT ainda não existe na API (feature `affiliate-credentials`, T7 em
 * `.specs/features/affiliate-credentials/tasks.md`). Enquanto não existir a
 * API responde 404 e o popup mostra o erro.
 */

/** Envelope padrão de `shared/http/httpResponse.ts`. */
export interface ApiEnvelope<T> {
  success: boolean;
  data: T;
  error?: { code?: string; message?: string };
  message?: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface TenantItem {
  id: string;
  name: string;
  slug: string;
  role: string;
}

export interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  user: { id: string; name: string; email: string; isSuperAdmin: boolean };
  tenants: TenantItem[];
}

export interface RefreshResponse {
  accessToken: string;
}

/** Sessão do marketplace capturada no navegador e enviada para o tenant. */
export interface AffiliateSessionSyncRequest {
  /** Cookie `ssid` do marketplace (sessão logada). */
  sessionToken: string;
  /** `meta[name=csrf-token]` da página do marketplace. */
  csrfToken: string;
  /** Etiqueta/ID de afiliado, se o operador informou no popup. */
  affiliateTag?: string;
  /** ISO 8601 do momento da captura. */
  capturedAt: string;
}

export interface AffiliateSessionSyncResponse {
  provider: 'MERCADO_LIVRE';
  status: 'ACTIVE' | 'INACTIVE';
  updatedAt: string;
}
