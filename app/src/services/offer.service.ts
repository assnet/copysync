import { apiClient } from './apiClient';
import type {
  ApiSuccess,
  GenerateOfferRequest,
  GenerateOfferResponse,
  OfferAudience,
  OfferConfigResponse,
  OfferItem,
  OfferUsage,
  RegenerateOfferResponse,
  SaveOfferConfigRequest,
  SendOfferResponse,
  UpdateOfferRequest,
} from '@/types/api.types';

const BASE = '/campaigns/offers';

export const offerService = {
  async generate(body: GenerateOfferRequest): Promise<GenerateOfferResponse> {
    const res = await apiClient.post<ApiSuccess<GenerateOfferResponse>>(BASE, body);
    return res.data.data;
  },

  async regenerate(id: string, audience?: OfferAudience): Promise<RegenerateOfferResponse> {
    const res = await apiClient.post<ApiSuccess<RegenerateOfferResponse>>(`${BASE}/${id}/regenerate`, { audience });
    return res.data.data;
  },

  async get(id: string): Promise<OfferItem> {
    const res = await apiClient.get<ApiSuccess<OfferItem>>(`${BASE}/${id}`);
    return res.data.data;
  },

  async update(id: string, body: UpdateOfferRequest): Promise<OfferItem> {
    const res = await apiClient.patch<ApiSuccess<OfferItem>>(`${BASE}/${id}`, body);
    return res.data.data;
  },

  async send(id: string): Promise<SendOfferResponse> {
    const res = await apiClient.post<ApiSuccess<SendOfferResponse>>(`${BASE}/${id}/send`, {});
    return res.data.data;
  },

  async usage(): Promise<OfferUsage> {
    const res = await apiClient.get<ApiSuccess<OfferUsage>>(`${BASE}/usage`);
    return res.data.data;
  },

  async getConfig(): Promise<OfferConfigResponse> {
    const res = await apiClient.get<ApiSuccess<OfferConfigApiDto>>(`${BASE}/config`);
    return toOfferConfig(res.data.data);
  },

  async saveConfig(body: SaveOfferConfigRequest): Promise<OfferConfigResponse> {
    const res = await apiClient.put<ApiSuccess<OfferConfigApiDto>>(`${BASE}/config`, body);
    return toOfferConfig(res.data.data);
  },
};

/** Formato plano devolvido pela API em `/config`. */
interface OfferConfigApiDto {
  sessionId: string | null;
  intervalMinSeconds: number;
  intervalMaxSeconds: number;
  groups: { id: string; title: string | null; sessionId: string | null }[];
  groupLimit: number | null;
  configured: boolean;
}

function toOfferConfig(dto: OfferConfigApiDto): OfferConfigResponse {
  return {
    config: dto.sessionId
      ? { sessionId: dto.sessionId, intervalMinSeconds: dto.intervalMinSeconds, intervalMaxSeconds: dto.intervalMaxSeconds }
      : null,
    groups: dto.groups.map((g) => ({ conversationId: g.id, title: g.title, sessionId: g.sessionId })),
    groupLimit: dto.groupLimit,
  };
}
