import { apiClient } from './apiClient';
import { resolveMediaUrl } from '@/utils/resolveMediaUrl';
import type {
  CreateSessionRequest,
  SessionItem,
  SessionListResponse,
  SessionStatusResponse,
  ConnectSessionResponse,
  SessionActionResponse,
  SessionQrResponse,
  SessionPairingCodeResponse,
} from '@/types/api.types';

export const sessionService = {
  async list(): Promise<SessionListResponse> {
    const res = await apiClient.get<SessionListResponse>('/sessions');
    return {
      ...res.data,
      // O avatar vem como caminho relativo à API, que em produção fica noutro domínio.
      sessions: res.data.sessions.map((s) => ({ ...s, avatarUrl: resolveMediaUrl(s.avatarUrl) })),
    };
  },

  async getById(id: string): Promise<SessionItem> {
    const res = await apiClient.get<SessionItem>(`/sessions/${id}`);
    return res.data;
  },

  async create(data: CreateSessionRequest): Promise<SessionItem> {
    const res = await apiClient.post<SessionItem>('/sessions', data);
    return res.data;
  },

  async getStatus(id: string): Promise<SessionStatusResponse> {
    const res = await apiClient.get<SessionStatusResponse>(`/sessions/${id}/status`);
    return res.data;
  },

  async connect(id: string): Promise<ConnectSessionResponse> {
    const res = await apiClient.post<ConnectSessionResponse>(`/sessions/${id}/connect`);
    return res.data;
  },

  async disconnect(id: string): Promise<SessionActionResponse> {
    const res = await apiClient.post<SessionActionResponse>(`/sessions/${id}/disconnect`);
    return res.data;
  },

  async reconnect(id: string): Promise<ConnectSessionResponse> {
    const res = await apiClient.post<ConnectSessionResponse>(`/sessions/${id}/reconnect`);
    return res.data;
  },

  async logout(id: string): Promise<SessionActionResponse> {
    const res = await apiClient.post<SessionActionResponse>(`/sessions/${id}/logout`);
    return res.data;
  },

  async getQr(id: string): Promise<SessionQrResponse> {
    const res = await apiClient.get<SessionQrResponse>(`/sessions/${id}/qr`);
    return res.data;
  },

  async getPairingCode(id: string): Promise<SessionPairingCodeResponse> {
    const res = await apiClient.get<SessionPairingCodeResponse>(`/sessions/${id}/pairing-code`);
    return res.data;
  },

  async delete(id: string): Promise<void> {
    await apiClient.delete(`/sessions/${id}`);
  },
};
