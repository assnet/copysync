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
}

export const extensionApi = {
  async issueSession(data: {
    installationId: string;
    deviceId?: string;
    extVersion: string;
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

  async getMlCredentialStatus(): Promise<MlCredentialStatus | null> {
    try {
      const { data } = await apiClient.get('/integrations/affiliate-credentials/MERCADO_LIVRE');
      return data.data ?? null;
    } catch {
      return null;
    }
  },

  async disconnectMl(): Promise<void> {
    await apiClient.delete('/integrations/affiliate-credentials/MERCADO_LIVRE/session');
  },
};
