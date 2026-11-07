import axios from 'axios';
import { apiClient } from '@/services/apiClient';
import type { ExtensionInstallSource } from '../config';

/**
 * Rotas públicas do ciclo de vida (desinstalação/feedback): sem o interceptor do `apiClient`,
 * para nunca enviar `Authorization` nem redirecionar ao login num 401.
 */
const publicClient = axios.create({
  baseURL: apiClient.defaults.baseURL,
  headers: { 'Content-Type': 'application/json' },
});

/** Motivos aceitos por `POST /extension/lifecycle/feedback` (rótulos em strings.ts). */
export const UNINSTALL_REASONS = [
  'not_working', 'hard_to_use', 'slow', 'fear_of_block',
  'no_longer_needed', 'price', 'other_tool', 'other',
] as const;
export type UninstallReason = typeof UNINSTALL_REASONS[number];
export const UNINSTALL_COMMENT_MAX = 500;

export interface ExtensionSessionInfo {
  id: string;
  installationId: string;
  extVersion: string;
  createdAt: string;
  lastSeenAt: string;
}

export interface MlCredentialStatus {
  provider: string;
  status: 'ACTIVE' | 'INACTIVE';
  hasSession: boolean;
  sessionInvalidAt: string | null;
  publicIdentifier: string | null;
  lastSyncAt: string | null;
  /** Loja recusou a sessão (no sync ou no monitor): loja pausada até um sync aceito. */
  rejectedAt: string | null;
}

export const extensionApi = {
  async issueSession(data: {
    installationId: string;
    deviceId?: string;
    extVersion: string;
    extensionId: string;
    channel: string;
    mlSessionConsent: boolean;
  }): Promise<void> {
    await apiClient.post('/extension/session', data, { withCredentials: true });
  },

  async revokeSession(): Promise<void> {
    const baseUrl = import.meta.env.VITE_API_URL ?? '/api';
    await fetch(`${baseUrl}/extension/session`, {
      method: 'DELETE',
      credentials: 'include',
      headers: { 'x-client': 'web' },
    });
  },

  async listSessions(): Promise<ExtensionSessionInfo[]> {
    const { data } = await apiClient.get('/extension/sessions');
    return data.data ?? [];
  },

  async revokeSessionById(id: string): Promise<void> {
    await apiClient.delete(`/extension/sessions/${id}`);
  },

  /** Lança em falha de rede/HTTP: quem chama decide (nunca confundir com "sem credencial"). */
  async getMlCredentialStatus(): Promise<MlCredentialStatus | null> {
    const { data } = await apiClient.get('/integrations/affiliate-credentials');
    const items = (data.data ?? []) as Array<{
      provider: string;
      status: 'ACTIVE' | 'INACTIVE';
      hasSession: boolean;
      publicIdentifier: string | null;
      sessionSyncedAt: string | null;
      rejectedAt: string | null;
    }>;
    const ml = items.find(i => i.provider === 'MERCADO_LIVRE');
    if (!ml) return null;
    return {
      provider: ml.provider,
      status: ml.status,
      hasSession: ml.hasSession,
      sessionInvalidAt: null,
      publicIdentifier: ml.publicIdentifier,
      lastSyncAt: ml.sessionSyncedAt,
      rejectedAt: ml.rejectedAt ?? null,
    };
  },

  async disconnectMl(): Promise<void> {
    await apiClient.delete('/extension/marketplaces/ml/session');
  },

  async grantMlConsent(installationId: string): Promise<void> {
    await apiClient.post('/extension/marketplaces/ml/consent', { installationId });
  },

  /** Clique em "Instalar". `false` = repetido em 60 s (a API deduplica). Nunca bloqueia abrir a loja. */
  async recordStoreClick(source: ExtensionInstallSource): Promise<boolean> {
    const { data } = await apiClient.post('/extension/store-click', { source });
    return !!data?.data?.recorded;
  },

  /** Pública: avisa que a instalação foi removida (página aberta pela própria extensão). */
  async reportUninstall(input: { installationId: string; extensionId?: string; version?: string }): Promise<void> {
    await publicClient.post('/extension/lifecycle/uninstall', input);
  },

  /** Pública: motivos da remoção (1..8) e comentário opcional (≤ 500). */
  async sendUninstallFeedback(input: { installationId: string; reasons: UninstallReason[]; comment?: string }): Promise<void> {
    await publicClient.post('/extension/lifecycle/feedback', input);
  },
};
