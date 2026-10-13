/**
 * Mensagens internas (popup ⇄ background ⇄ content) e estado persistido.
 * Tudo tipado aqui; nenhum lado inventa `action` string solta.
 */
import type { TenantItem } from './api.js';

// ── Estado persistido em chrome.storage.local ────────────────────────────────

export const STORAGE_KEYS = {
  auth: 'auth',
  settings: 'settings',
  syncState: 'syncState',
} as const;

export interface StoredAuth {
  accessToken: string;
  refreshToken: string;
  user: { id: string; name: string; email: string };
  tenants: TenantItem[];
  /** Tenant ativo (header X-Tenant-Id). */
  tenantId: string;
}

export interface StoredSettings {
  affiliateTag?: string;
  /** Preferência de tema do popup. `system` segue `prefers-color-scheme`. */
  theme: 'system' | 'light' | 'dark';
}

export type SyncStatus = 'idle' | 'syncing' | 'ok' | 'error';

export interface SyncState {
  status: SyncStatus;
  /** ISO 8601 do início da sincronização em curso. `syncing` velho vira `idle`. */
  startedAt?: string;
  /** ISO 8601 da última sincronização bem-sucedida. */
  lastSyncAt?: string;
  /** Código de erro traduzível (chave i18n `err_*`), nunca texto cru da API. */
  lastErrorCode?: SyncErrorCode;
  /** Detalhe técnico opcional (status HTTP, mensagem), só para DEV. */
  lastErrorDetail?: string;
}

export type SyncErrorCode =
  | 'not_authenticated'
  | 'marketplace_not_logged'
  | 'marketplace_tab_missing'
  | 'csrf_missing'
  | 'api_unreachable'
  | 'api_rejected'
  | 'api_unauthorized'
  | 'api_route_missing'
  | 'login_invalid'
  | 'login_no_tenant';

// ── Mensagens runtime ────────────────────────────────────────────────────────

export type RuntimeRequest =
  | { type: 'auth/login'; email: string; password: string }
  | { type: 'auth/logout' }
  | { type: 'auth/select-tenant'; tenantId: string }
  | { type: 'session/sync-now' }
  | { type: 'session/get-state' }
  | { type: 'marketplace/check-login' }
  | { type: 'settings/save'; settings: Partial<StoredSettings> };

export interface MarketplaceLoginCheck {
  loggedIn: boolean;
  hasOpenTab: boolean;
}

/** Auth sem tokens: é o que atravessa para o popup. Tokens ficam no background. */
export type AuthSummary = Pick<StoredAuth, 'user' | 'tenants' | 'tenantId'>;

export interface SessionStateSnapshot {
  auth: AuthSummary | null;
  settings: StoredSettings;
  sync: SyncState;
  marketplace: MarketplaceLoginCheck;
}

export type RuntimeResponse =
  | { ok: true; state: SessionStateSnapshot }
  | { ok: false; errorCode: SyncErrorCode; detail?: string };

/** Mensagem do background para o content script (mundo isolado da página). */
export type ContentRequest = { type: 'page/get-csrf' };
export type ContentResponse = { csrfToken: string | null };
