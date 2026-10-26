import { apiClient } from './apiClient';

export interface InviteInfo {
  email: string;
  tenantName: string;
  role: string;
  expiresAt: string;
  requiresPassword: boolean;
  requiresLogin: boolean;
}

export interface AcceptInviteBody {
  password?: string;
  confirmPassword?: string;
}

export interface AcceptInviteResult {
  status: 'ACCEPTED' | 'REQUIRES_LOGIN';
  tenantId?: string;
  userId?: string;
  isNewUser?: boolean;
  email?: string;
  hint?: string;
}

export const inviteService = {
  async getInfo(token: string): Promise<InviteInfo> {
    const res = await apiClient.get<{ success: true; data: InviteInfo }>(
      `/auth/invites/${token}`,
    );
    return res.data.data;
  },

  async accept(token: string, body: AcceptInviteBody): Promise<AcceptInviteResult> {
    const res = await apiClient.post<{ success: true; data: AcceptInviteResult }>(
      `/auth/invites/${token}/accept`,
      body,
    );
    return res.data.data;
  },
};
