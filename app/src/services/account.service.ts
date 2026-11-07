import { apiClient } from './apiClient';
import type { ApiSuccess, ChangePasswordRequest } from '@/types/api.types';

/** Autopreenchimento do link de pagamento (só chaves válidas; ver docs/planos.md). */
export interface CheckoutPrefillResponse {
  email?: string;
  confirmEmail?: string;
  name?: string;
}

export const accountService = {
  async changePassword(data: ChangePasswordRequest): Promise<void> {
    await apiClient.patch('/me/password', data);
  },

  /** Dado pessoal: quem chama guarda só em memória. `timeout` curto: falha = link sem dados. */
  async getCheckoutPrefill(options: { timeout: number; signal?: AbortSignal }): Promise<CheckoutPrefillResponse> {
    const res = await apiClient.get<ApiSuccess<CheckoutPrefillResponse>>('/me/checkout-prefill', options);
    return res.data.data;
  },
};
