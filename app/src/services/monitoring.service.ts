import { apiClient } from './apiClient';
import type {
  ApiSuccess,
  CapturedOfferItem,
  CapturedOffersResponse,
  GroupMonitorConfigResponse,
  SaveBroadcastGroupsRequest,
  SaveGroupMonitorSettingsRequest,
  SaveMonitoredGroupsRequest,
} from '@/types/api.types';

const BASE = '/automation/group-monitoring';

/** Monitoramento de grupos (docs/monitoramento-grupos.md): configuração por sessão e ofertas capturadas. */
export const monitoringService = {
  async getConfig(sessionId: string): Promise<GroupMonitorConfigResponse> {
    const res = await apiClient.get<ApiSuccess<GroupMonitorConfigResponse>>(`${BASE}/config`, { params: { sessionId } });
    return res.data.data;
  },

  async saveSettings(body: SaveGroupMonitorSettingsRequest): Promise<GroupMonitorConfigResponse> {
    const res = await apiClient.put<ApiSuccess<GroupMonitorConfigResponse>>(`${BASE}/config`, body);
    return res.data.data;
  },

  /** Recusa com `PLAN_LIMIT_REACHED` (403/422) se passar do limite do plano. */
  async saveMonitoredGroups(body: SaveMonitoredGroupsRequest): Promise<GroupMonitorConfigResponse> {
    const res = await apiClient.put<ApiSuccess<GroupMonitorConfigResponse>>(`${BASE}/config/monitored-groups`, body);
    return res.data.data;
  },

  /** Ordem do array = ordem de envio. */
  async saveBroadcastGroups(body: SaveBroadcastGroupsRequest): Promise<GroupMonitorConfigResponse> {
    const res = await apiClient.put<ApiSuccess<GroupMonitorConfigResponse>>(`${BASE}/config/broadcast-groups`, body);
    return res.data.data;
  },

  /** Página de ofertas capturadas; `cursor` é o opaco devolvido pela página anterior. */
  async listCaptured(sessionId: string, cursor?: string | null): Promise<CapturedOffersResponse> {
    const res = await apiClient.get<ApiSuccess<CapturedOffersResponse>>(`${BASE}/captured`, {
      params: { sessionId, ...(cursor ? { cursor } : {}) },
    });
    return res.data.data;
  },

  async retryCaptured(id: string): Promise<CapturedOfferItem> {
    const res = await apiClient.post<ApiSuccess<CapturedOfferItem>>(`${BASE}/captured/${id}/retry`, {});
    return res.data.data;
  },
};
