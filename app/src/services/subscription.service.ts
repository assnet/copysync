import { apiClient } from './apiClient';
import type { ApiSuccess, SubscriptionResponse } from '@/types/api.types';

/**
 * Assinatura do tenant ativo: plano, status, vencimento e uso × limite.
 * A rota responde também com tenant SUSPENDED/CANCELLED (só leitura).
 */
export const subscriptionService = {
  async getSubscription(): Promise<SubscriptionResponse> {
    const res = await apiClient.get<ApiSuccess<SubscriptionResponse>>('/subscription');
    return res.data.data;
  },
};
