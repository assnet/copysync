import { apiClient } from './apiClient';
import type { ApiSuccess, SendQueuePauseResponse, SendQueueResponse } from '@/types/api.types';

/**
 * Fila de envio por sessão (docs/fila-de-envio.md). Controles por oferta ficam em `offerService`;
 * aqui só a leitura e a pausa global da conta (todas as sessões e origens).
 */
export const SEND_QUEUE_REQUEST_TIMEOUT_MS = 15_000;

export const sendQueueService = {
  async get(sessionId?: string): Promise<SendQueueResponse> {
    // Com timeout: um GET que nunca responde travaria o polling encadeado do painel
    const res = await apiClient.get<ApiSuccess<SendQueueResponse>>('/campaigns/send-queue', {
      params: sessionId ? { sessionId } : undefined,
      timeout: SEND_QUEUE_REQUEST_TIMEOUT_MS,
    });
    return res.data.data;
  },
  async pauseAll(): Promise<SendQueuePauseResponse> {
    const res = await apiClient.post<ApiSuccess<SendQueuePauseResponse>>('/campaigns/send-queue/pause', undefined, { timeout: SEND_QUEUE_REQUEST_TIMEOUT_MS });
    return res.data.data;
  },
  async resumeAll(): Promise<SendQueuePauseResponse> {
    const res = await apiClient.post<ApiSuccess<SendQueuePauseResponse>>('/campaigns/send-queue/resume', undefined, { timeout: SEND_QUEUE_REQUEST_TIMEOUT_MS });
    return res.data.data;
  },
};
