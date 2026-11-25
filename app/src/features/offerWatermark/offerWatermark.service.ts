import { apiClient } from '@/services/apiClient';
import type { ApiSuccess } from '@/types/api.types';
import type { OfferWatermark, UpdateOfferWatermarkInput } from './types';

const BASE = '/offer-watermark';

/**
 * Marca d'água própria das ofertas (rotas em `api/src/modules/campaigns/presentation/routes/offerWatermark.routes.ts`).
 * Fora da audiência: 404 em tudo menos `/access`. Sem plano: 403 `PLAN_FEATURE_UNAVAILABLE`
 * (`meta.key: 'offer_watermark_enabled'`). Operador: 403 `FORBIDDEN` ao gravar.
 */
export const offerWatermarkService = {
  /** Visibilidade do menu e da rota. Nunca 403. */
  async getAccess(): Promise<{ visible: boolean }> {
    const res = await apiClient.get<ApiSuccess<{ visible: boolean }>>(`${BASE}/access`);
    return res.data.data;
  },

  async get(): Promise<OfferWatermark> {
    const res = await apiClient.get<ApiSuccess<OfferWatermark>>(BASE);
    return res.data.data;
  },

  /** Parcial; 422 `OFFER_WATERMARK_INVALID_INPUT` com `meta.field`. */
  async update(input: UpdateOfferWatermarkInput): Promise<OfferWatermark> {
    const res = await apiClient.put<ApiSuccess<OfferWatermark>>(BASE, input);
    return res.data.data;
  },

  /** `uploadId` de um `chunkedUpload` concluído; a API valida pelo conteúdo e troca o logo anterior. */
  async setImage(uploadId: string): Promise<OfferWatermark> {
    const res = await apiClient.put<ApiSuccess<OfferWatermark>>(`${BASE}/image`, { uploadId });
    return res.data.data;
  },

  /** Remove o logo; texto e ajustes seguem. */
  async removeImage(): Promise<OfferWatermark> {
    const res = await apiClient.delete<ApiSuccess<OfferWatermark>>(`${BASE}/image`);
    return res.data.data;
  },
};
