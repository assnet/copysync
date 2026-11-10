import { apiClient } from './apiClient';
import type { ApiSuccess } from '@/types/api.types';
import type { OpsLatest, OpsSeriesResult } from '@/features/opsMetrics/types';

/** Métricas de recursos da plataforma — rotas só de super admin (lêem só tabelas locais). */
export const opsMetricsService = {
  /** Séries agregadas no servidor (máx. 12 métricas, janela máx. 7 dias). */
  async series(metrics: string[], window: { from: string; to: string }): Promise<OpsSeriesResult> {
    const res = await apiClient.get<ApiSuccess<OpsSeriesResult>>('/admin/ops/metrics/series', {
      params: { metrics: metrics.join(','), from: window.from, to: window.to },
    });
    return res.data.data;
  },

  /** Valores atuais, limiares, consultas mais caras e workers vivos. */
  async latest(): Promise<OpsLatest> {
    const res = await apiClient.get<ApiSuccess<OpsLatest>>('/admin/ops/metrics/latest');
    return res.data.data;
  },
};
