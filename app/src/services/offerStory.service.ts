import { apiClient } from './apiClient';
import type { ApiSuccess } from '@/types/api.types';
import type { OfferStoryResult, OfferStoryTemplate, RenderOfferStoryInput } from '@/features/offerStory/types';

const BASE = '/offer-story';

/**
 * Story de Oferta (contrato em `api/src/modules/offer-story/presentation/`).
 * Sem plano: 403 `PLAN_FEATURE_UNAVAILABLE` (ver `features/offerStory/planGate.ts`).
 */
export const offerStoryService = {
  async listTemplates(): Promise<OfferStoryTemplate[]> {
    const res = await apiClient.get<ApiSuccess<{ templates: OfferStoryTemplate[] }>>(`${BASE}/templates`);
    return res.data.data.templates;
  },

  /** Arte 1080×1920 em data URL. 422 `OFFER_*`/`OFFER_STORY_*`, 429 `RATE_LIMITED`. */
  async render(input: RenderOfferStoryInput): Promise<OfferStoryResult> {
    const res = await apiClient.post<ApiSuccess<OfferStoryResult>>(`${BASE}/render`, input);
    return res.data.data;
  },
};
