import { apiClient } from './apiClient';

export interface PasswordResetInfo {
  email: string;
  expiresAt: string;
}

export interface RequestPasswordResetBody {
  email: string;
  turnstileToken?: string;
}

export interface ResetPasswordBody {
  password: string;
  confirmPassword: string;
}

/**
 * Redefinição de senha ("esqueci minha senha"). O pedido responde 202 mesmo quando o e-mail não
 * existe; o token do link nunca é guardado nem exibido (docs/recuperacao-de-senha.md).
 */
export const passwordResetService = {
  async request(body: RequestPasswordResetBody): Promise<void> {
    await apiClient.post('/auth/password/forgot', body);
  },

  // Token sempre no corpo: a URL da API vai para o log de requisições (docs/recuperacao-de-senha.md).
  async getInfo(token: string): Promise<PasswordResetInfo> {
    const res = await apiClient.post<{ success: true; data: PasswordResetInfo }>(
      '/auth/password/reset/inspect',
      { token },
    );
    return res.data.data;
  },

  async reset(token: string, body: ResetPasswordBody): Promise<void> {
    await apiClient.post('/auth/password/reset', { token, ...body });
  },
};
