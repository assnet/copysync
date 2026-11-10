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

/** Credencial de sessão de um marketplace (nome histórico: nasceu só para o ML). */
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

/** Marketplace com sessão pela extensão (segmento da rota `/extension/marketplaces/<id>`). */
export type ExtensionMarketplaceId = 'ml' | 'shein';

const MARKETPLACE_PROVIDER: Record<ExtensionMarketplaceId, string> = { ml: 'MERCADO_LIVRE', shein: 'SHEIN' };

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

  /**
   * Desvincula esta instalação pelo painel (Bearer): acha a sessão ativa da instalação e a revoga.
   * Nunca `DELETE /extension/session`: essa rota é só da extensão (`x-client: extension` + cookie)
   * e responde 403 ao painel. Sem sessão ativa = já desvinculada (não é erro).
   */
  async revokeSession(installationId: string): Promise<void> {
    const sessions = await extensionApi.listSessions();
    const mine = sessions.filter((s) => s.installationId === installationId);
    for (const s of mine) await extensionApi.revokeSessionById(s.id);
  },

  async listSessions(): Promise<ExtensionSessionInfo[]> {
    const { data } = await apiClient.get('/extension/sessions');
    return data.data ?? [];
  },

  async revokeSessionById(id: string): Promise<void> {
    await apiClient.delete(`/extension/sessions/${id}`);
  },

  /**
   * Credencial de cada marketplace (sessão sincronizada pela extensão), lida da lista do painel.
   * Lança em falha de rede/HTTP: quem chama decide (nunca confundir com "sem credencial").
   */
  async getCredentialStatuses(): Promise<Record<ExtensionMarketplaceId, MlCredentialStatus | null>> {
    const { data } = await apiClient.get('/integrations/affiliate-credentials');
    // A lista vem em `{ items, marketplaceAvailability }`; array puro = API antiga.
    const raw = data?.data;
    const items = (Array.isArray(raw) ? raw : raw?.items ?? []) as Array<{
      provider: string;
      status: 'ACTIVE' | 'INACTIVE';
      hasSession: boolean;
      publicIdentifier: string | null;
      sessionSyncedAt: string | null;
      rejectedAt: string | null;
    }>;
    const pick = (marketplace: ExtensionMarketplaceId): MlCredentialStatus | null => {
      const found = items.find(i => i.provider === MARKETPLACE_PROVIDER[marketplace]);
      if (!found) return null;
      return {
        provider: found.provider,
        status: found.status,
        hasSession: found.hasSession,
        sessionInvalidAt: null,
        publicIdentifier: found.publicIdentifier,
        lastSyncAt: found.sessionSyncedAt,
        rejectedAt: found.rejectedAt ?? null,
      };
    };
    return { ml: pick('ml'), shein: pick('shein') };
  },

  async getCredentialStatus(marketplace: ExtensionMarketplaceId): Promise<MlCredentialStatus | null> {
    return (await extensionApi.getCredentialStatuses())[marketplace];
  },

  async getMlCredentialStatus(): Promise<MlCredentialStatus | null> {
    return extensionApi.getCredentialStatus('ml');
  },

  /** Revoga o consentimento e apaga a credencial do marketplace (nunca o DELETE genérico de credenciais). */
  async disconnect(marketplace: ExtensionMarketplaceId): Promise<void> {
    await apiClient.delete(`/extension/marketplaces/${marketplace}/session`);
  },

  /** Consentimento desta instalação. Shein: 404 `SESSION_NOT_FOUND`, 403 plano/aceite de risco. */
  async consent(marketplace: ExtensionMarketplaceId, installationId: string): Promise<void> {
    await apiClient.post(`/extension/marketplaces/${marketplace}/consent`, { installationId });
  },

  async disconnectMl(): Promise<void> {
    await extensionApi.disconnect('ml');
  },

  async grantMlConsent(installationId: string): Promise<void> {
    await extensionApi.consent('ml', installationId);
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
