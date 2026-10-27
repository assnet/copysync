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
  SessionGroupsResponse,
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

  /** Todos os grupos da sessão no WhatsApp (não só os com mensagem), com busca no servidor. */
  async listSessionGroups(sessionId: string, search?: string): Promise<SessionGroupsResponse> {
    const res = await apiClient.get<ApiSuccess<SessionGroupsResponse>>(`${BASE}/config/groups`, {
      params: { sessionId, search: search || undefined },
    });
    return res.data.data;
  },

  /** Cria (ou acha) a conversa do grupo escolhido; devolve o id usado como destino. */
  async ensureSessionGroup(sessionId: string, groupJid: string): Promise<{ conversationId: string; title: string | null }> {
    const res = await apiClient.post<ApiSuccess<{ conversationId: string; title: string | null }>>(
      `${BASE}/config/groups/ensure`,
      { sessionId, groupJid },
    );
    return res.data.data;
  },
};

/** Formato plano devolvido pela API em `/config`. */
interface OfferConfigApiDto {
  sessionId: string | null;
  intervalMinSeconds: number;
  intervalMaxSeconds: number;
  groups: { id: string; title: string | null; avatarUrl?: string | null; sessionId: string | null }[];
  groupLimit: number | null;
  configured: boolean;
}

function toOfferConfig(dto: OfferConfigApiDto): OfferConfigResponse {
  return {
    config: dto.sessionId
      ? { sessionId: dto.sessionId, intervalMinSeconds: dto.intervalMinSeconds, intervalMaxSeconds: dto.intervalMaxSeconds }
      : null,
    groups: dto.groups.map((g) => ({ conversationId: g.id, title: g.title, avatarUrl: g.avatarUrl ?? null, sessionId: g.sessionId })),
    groupLimit: dto.groupLimit,
  };
}
