import { apiClient } from './apiClient';
import type { ApiSuccess, BroadcastGroupsResponse } from '@/types/api.types';

/** Catálogo dos grupos de disparo do tenant (gerador + monitoramentos); ver docs/grupos-de-disparo-e-horario.md. */
const BASE = '/campaigns/broadcast-groups';

export const broadcastGroupsService = {
  async list(): Promise<BroadcastGroupsResponse> {
    const res = await apiClient.get<ApiSuccess<BroadcastGroupsResponse>>(BASE);
    return res.data.data;
  },
  /** Tira o grupo de todos os usos do tenant (idempotente). */
  async remove(conversationId: string): Promise<void> {
    await apiClient.delete(`${BASE}/${encodeURIComponent(conversationId)}`);
  },
};
