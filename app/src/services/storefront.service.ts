import { apiClient } from './apiClient';
import type { ApiSuccess } from '@/types/api.types';
import type {
  SaveStorefrontInput,
  SlugAvailability,
  Storefront,
  StorefrontImageKind,
  StorefrontOffer,
  StorefrontOfferStatus,
  StorefrontOverview,
  StorefrontPreviewDraft,
  StorefrontViewport,
  UpdateStorefrontOfferInput,
} from '@/features/storefront/types';

const BASE = '/storefront';
const offer = (id: string) => `${BASE}/offers/${encodeURIComponent(id)}`;

/**
 * Página de Ofertas do tenant (contrato em `api/src/modules/storefront/presentation/`).
 * Sem plano: 403 `PLAN_FEATURE_UNAVAILABLE` (ver `features/storefront/planGate.ts`).
 *
 * SPEC_DEVIATION: design §4.8 pede `features/storefront/services/storefrontApi.ts`. Reason: o
 * padrão do painel é `services/<recurso>.service.ts` (ex.: `linkRotation.service.ts`).
 */
export const storefrontService = {
  /** Página (ou null), ofertas por aba, endereço público, categorias, sugestões e domínios. */
  async getStorefront(): Promise<StorefrontOverview> {
    const res = await apiClient.get<ApiSuccess<StorefrontOverview>>(BASE);
    return res.data.data;
  },

  /** Sem `domainId`: domínio atual da página ou o primeiro ativo. 429 `RATE_LIMITED`. */
  async checkSlug(slug: string, domainId?: string): Promise<SlugAvailability> {
    const res = await apiClient.get<ApiSuccess<SlugAvailability>>(`${BASE}/slug-availability`, {
      params: domainId ? { slug, domainId } : { slug },
    });
    return res.data.data;
  },

  /** Cria ou atualiza; troca de nome/domínio move o endereço (o antigo fica reservado). */
  async saveStorefront(body: SaveStorefrontInput): Promise<Storefront> {
    const res = await apiClient.put<ApiSuccess<Storefront>>(BASE, body);
    return res.data.data;
  },

  /** `uploadId` de um `chunkedUpload` concluído. */
  async setImage(kind: StorefrontImageKind, uploadId: string): Promise<{ url: string }> {
    const res = await apiClient.put<ApiSuccess<{ url: string }>>(`${BASE}/images/${kind}`, { uploadId });
    return res.data.data;
  },

  async removeImage(kind: StorefrontImageKind): Promise<void> {
    await apiClient.delete(`${BASE}/images/${kind}`);
  },

  /** HTML da prévia, para `<iframe sandbox srcdoc>`. 429 `RATE_LIMITED`. */
  async preview(draft: StorefrontPreviewDraft, viewport: StorefrontViewport): Promise<string> {
    const res = await apiClient.post<ApiSuccess<{ html: string }>>(`${BASE}/preview`, { ...draft, viewport });
    return res.data.data.html;
  },

  /** Extrai do link do produto; entra como rascunho. 429 `RATE_LIMITED`. */
  async extractOffer(url: string, category?: string | null): Promise<StorefrontOffer> {
    const body = category === undefined ? { url } : { url, category };
    const res = await apiClient.post<ApiSuccess<StorefrontOffer>>(`${BASE}/offers`, body);
    return res.data.data;
  },

  async updateOffer(id: string, body: UpdateStorefrontOfferInput): Promise<StorefrontOffer> {
    const res = await apiClient.patch<ApiSuccess<StorefrontOffer>>(offer(id), body);
    return res.data.data;
  },

  /** Publicar ou voltar para rascunho; a oferta vai para o fim da aba. */
  async setOfferStatus(id: string, status: StorefrontOfferStatus): Promise<StorefrontOffer> {
    const res = await apiClient.post<ApiSuccess<StorefrontOffer>>(`${offer(id)}/status`, { status });
    return res.data.data;
  },

  /** Lista completa da aba na nova ordem; faltando/sobrando → `STOREFRONT_ORDER_INVALID`. */
  async reorderOffers(status: StorefrontOfferStatus, ids: string[]): Promise<void> {
    await apiClient.put(`${BASE}/offers/order`, { status, ids });
  },

  async deleteOffer(id: string): Promise<void> {
    await apiClient.delete(offer(id));
  },
};
