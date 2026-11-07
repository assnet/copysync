import { apiClient } from './apiClient';
import type { LoginRequest, LoginResponse, RefreshResponse } from '@/types/api.types';
import type { LoginCodeChallenge } from '@/features/login-protection/loginProtection';

export interface LoginPublicConfig {
  mode: 'off' | 'monitor' | 'enforce';
  turnstileSiteKey: string | null;
  emailCode: boolean;
}

/** 200 = sessão; 202 = login suspeito, segue para o passo do código (docs/seguranca-login.md). */
export type LoginApiResult =
  | { status: 'SESSION'; session: LoginResponse }
  | { status: 'OTP_REQUIRED'; challenge: LoginCodeChallenge };

export const authService = {
  async login(data: LoginRequest): Promise<LoginApiResult> {
    const res = await apiClient.post<{ success: true; data: LoginResponse | (LoginCodeChallenge & { status: 'OTP_REQUIRED' }) }>('/auth/login', data);
    const body = res.data.data;
    if (res.status === 202 && 'status' in body && body.status === 'OTP_REQUIRED') {
      const { ticket, codeSent, codeExpiresAt, resendAvailableAt } = body;
      return { status: 'OTP_REQUIRED', challenge: { ticket, codeSent, codeExpiresAt, resendAvailableAt } };
    }
    return { status: 'SESSION', session: body as LoginResponse };
  },

  /** Config pública do login: site key do Turnstile (null = não exigido), modo e código por e-mail. */
  async loginConfig(): Promise<LoginPublicConfig> {
    const res = await apiClient.get<{ success: true; data: LoginPublicConfig }>('/auth/login/config');
    return res.data.data;
  },

  async verifyLoginCode(ticket: string, code: string): Promise<LoginResponse> {
    const res = await apiClient.post<{ success: true; data: LoginResponse }>('/auth/login/verify', { ticket, code });
    return res.data.data;
  },

  async resendLoginCode(ticket: string): Promise<LoginCodeChallenge> {
    const res = await apiClient.post<{ success: true; data: LoginCodeChallenge }>('/auth/login/resend', { ticket });
    const { codeSent, codeExpiresAt, resendAvailableAt } = res.data.data;
    return { ticket: res.data.data.ticket, codeSent, codeExpiresAt, resendAvailableAt };
  },

  async refresh(refreshToken: string): Promise<RefreshResponse> {
    const res = await apiClient.post<{ success: true; data: RefreshResponse }>('/auth/refresh', {
      refreshToken,
    });
    return res.data.data;
  },

  async logout(refreshToken: string): Promise<void> {
    await apiClient.post('/auth/logout', { refreshToken });
  },
};
