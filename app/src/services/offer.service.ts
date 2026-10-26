import { apiClient } from './apiClient';
import type {
  ApiSuccess,
  GenerateOfferResponse,
  OfferDestinationItem,
  OfferItem,
  OfferUsage,
  SendOfferResponse,
  UpdateOfferRequest,
} from '@/types/api.types';

const BASE = '/campaigns/offers';

export const offerService = {
  async generate(url: string): Promise<GenerateOfferResponse> {
    const res = await apiClient.post<ApiSuccess<GenerateOfferResponse>>(BASE, { url });
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

  async listDestinations(): Promise<OfferDestinationItem[]> {
    const res = await apiClient.get<ApiSuccess<OfferDestinationItem[]>>(`${BASE}/destinations`);
    return res.data.data;
  },

  async replaceDestinations(conversationIds: string[]): Promise<OfferDestinationItem[]> {
    const res = await apiClient.put<ApiSuccess<OfferDestinationItem[]>>(`${BASE}/destinations`, { conversationIds });
    return res.data.data;
  },
};
