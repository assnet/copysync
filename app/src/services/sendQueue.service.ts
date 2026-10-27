import { apiClient } from './apiClient';
import type { ApiSuccess, SendQueueResponse } from '@/types/api.types';

/** Fila de envio por sessão (docs/fila-de-envio.md). Só leitura; controles ficam em `offerService`. */
export const sendQueueService = {
  async get(sessionId?: string): Promise<SendQueueResponse> {
    const res = await apiClient.get<ApiSuccess<SendQueueResponse>>('/campaigns/send-queue', {
      params: sessionId ? { sessionId } : undefined,
    });
    return res.data.data;
  },
};
