import { apiClient } from './apiClient';
import type { ApiSuccess } from '@/types/api.types';
import type { UsageFeatureDetail, UsageQuery, UsageSummary, UsageTenantsPage } from '@/features/featureUsage/types';

/**
 * Uso dos recursos — rotas só de super admin (`/admin/usage/*`). A query vem pronta de `toUsageQuery` (todo filtro
 * explícito). Uma leitura por vez: quem chama não dispara duas em paralelo (a API recusa a segunda com 503).
 * A lista de contas pagina só pelo `cursor` opaco devolvido pela API (nunca `limit`/`offset`).
 */
export const adminUsageService = {
  async getSummary(query: UsageQuery): Promise<UsageSummary> {
    const res = await apiClient.get<ApiSuccess<UsageSummary>>('/admin/usage/summary', { params: query });
    return res.data.data;
  },

  /** 404 `USAGE_METRICS_FEATURE_NOT_FOUND` para chave fora do catálogo. */
  async getDetail(featureKey: string, query: UsageQuery): Promise<UsageFeatureDetail> {
    const res = await apiClient.get<ApiSuccess<UsageFeatureDetail>>(
      `/admin/usage/features/${encodeURIComponent(featureKey)}`,
      { params: query },
    );
    return res.data.data;
  },

  /** Só depois que o detalhe respondeu. 400 `USAGE_METRICS_CURSOR_INVALID` → recomeçar do início. */
  async getTenants(featureKey: string, query: UsageQuery, cursor?: string | null): Promise<UsageTenantsPage> {
    const params: UsageQuery = cursor ? { ...query, cursor } : { ...query };
    const res = await apiClient.get<ApiSuccess<UsageTenantsPage>>(
      `/admin/usage/features/${encodeURIComponent(featureKey)}/tenants`,
      { params },
    );
    return res.data.data;
  },
};
