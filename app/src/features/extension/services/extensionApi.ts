import { apiClient } from '@/services/apiClient';

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
};
