import { apiClient } from './apiClient';
import type { ApiSuccess, SendQueuePauseResponse, SendQueueResponse } from '@/types/api.types';

/**
 * Fila de envio por sessão (docs/fila-de-envio.md). Controles por oferta ficam em `offerService`;
 * aqui só a leitura e a pausa global da conta (todas as sessões e origens).
 */
export const sendQueueService = {
  async get(sessionId?: string): Promise<SendQueueResponse> {
    const res = await apiClient.get<ApiSuccess<SendQueueResponse>>('/campaigns/send-queue', {
      params: sessionId ? { sessionId } : undefined,
    });
    return res.data.data;
  },
  async pauseAll(): Promise<SendQueuePauseResponse> {
    const res = await apiClient.post<ApiSuccess<SendQueuePauseResponse>>('/campaigns/send-queue/pause');
    return res.data.data;
  },
  async resumeAll(): Promise<SendQueuePauseResponse> {
    const res = await apiClient.post<ApiSuccess<SendQueuePauseResponse>>('/campaigns/send-queue/resume');
    return res.data.data;
  },
};
