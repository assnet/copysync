import { apiClient } from './apiClient';
import type { ApiSuccess } from '@/types/api.types';
import { toSettingsPayload } from '@/features/infraCosts/rules';
import type {
  InfraCostSettingsView,
  InfraCostSummary,
  UpdateInfraCostSettingsInput,
} from '@/features/infraCosts/types';

/**
 * Custos da infraestrutura — rotas só de super admin. Preço de plano nunca vai no corpo nem na query:
 * a margem é calculada no painel (`features/infraCosts/rules.ts`, `planMargin`).
 */
export const adminCostsService = {
  async getSettings(): Promise<InfraCostSettingsView> {
    const res = await apiClient.get<ApiSuccess<InfraCostSettingsView>>('/admin/costs/settings');
    return res.data.data;
  },

  /** 400 `INVALID_INFRA_COST_SETTINGS` (`meta.field`) · 409 `INFRA_COST_SETTINGS_CONFLICT`. Corpo só com campos do contrato. */
  async updateSettings(input: UpdateInfraCostSettingsInput): Promise<InfraCostSettingsView> {
    const body: UpdateInfraCostSettingsInput = {
      settings: toSettingsPayload(input.settings),
      expectedUpdatedAt: input.expectedUpdatedAt,
    };
    const res = await apiClient.put<ApiSuccess<InfraCostSettingsView>>('/admin/costs/settings', body);
    return res.data.data;
  },

  /** `month` = `YYYY-MM`; omitido = mês corrente do servidor. 400 `INFRA_COST_MONTH_UNAVAILABLE` (P1: só o corrente). */
  async getSummary(month?: string | null): Promise<InfraCostSummary> {
    const res = await apiClient.get<ApiSuccess<InfraCostSummary>>('/admin/costs/summary', {
      params: month ? { month } : undefined,
    });
    return res.data.data;
  },
};
