import { apiClient } from './apiClient';
import type { ApiSuccess } from '@/types/api.types';
import type {
  UpdateWorkerScalingSettingsInput,
  WorkerCapacityView,
  WorkerOccupancyList,
  WorkerScaleEventsPage,
  WorkerScaleRequestInput,
  WorkerScaleRequestResult,
  WorkerScaleStateView,
  WorkerScalingSettingsView,
} from '@/features/workersAdmin/types';

/** Ocupação e configuração dos workers — rotas só de super admin. */
export const adminWorkersService = {
  async list(): Promise<WorkerOccupancyList> {
    const res = await apiClient.get<ApiSuccess<WorkerOccupancyList>>('/admin/workers');
    return res.data.data;
  },

  async getSettings(): Promise<WorkerScalingSettingsView> {
    const res = await apiClient.get<ApiSuccess<WorkerScalingSettingsView>>('/admin/workers/settings');
    return res.data.data;
  },

  /** 400 `INVALID_WORKER_SCALING_SETTINGS` (`meta.field`) · 409 `WORKER_SCALING_SETTINGS_CONFLICT`. */
  async updateSettings(input: UpdateWorkerScalingSettingsInput): Promise<WorkerScalingSettingsView> {
    const res = await apiClient.put<ApiSuccess<WorkerScalingSettingsView>>('/admin/workers/settings', input);
    return res.data.data;
  },

  /** Capacidade do cluster e contagens por plano (WSCALE-09). Sem série: ela vem de `/admin/ops/metrics/series`. */
  async getCapacity(): Promise<WorkerCapacityView> {
    const res = await apiClient.get<ApiSuccess<WorkerCapacityView>>('/admin/workers/capacity');
    return res.data.data;
  },

  /** Estado do escalador, faixa de réplicas, intervalo mínimo e último evento (WSCALE-14). */
  async getScale(): Promise<WorkerScaleStateView> {
    const res = await apiClient.get<ApiSuccess<WorkerScaleStateView>>('/admin/workers/scale');
    return res.data.data;
  },

  /**
   * Pede réplicas ao provedor. Mesmo `requestId` = replay (`replayed: true`). Erros com `code`/`meta`:
   * 400 `SCALE_TARGET_OUT_OF_RANGE` · 409 `SCALER_MODE_OFF`, `ADOPTION_DISABLED`, `SCALER_NOT_CONFIGURED`,
   * `SCALE_COOLDOWN_ACTIVE`, `SCALE_TARGET_UNCHANGED`, `SCALE_DOWN_WOULD_EXCEED_CAPACITY`,
   * `SCALER_SERVICE_NOT_SCALABLE` · 429 `SCALER_RATE_LIMITED` · 503 `SCALER_UNAVAILABLE`.
   */
  async requestScale(input: WorkerScaleRequestInput): Promise<WorkerScaleRequestResult> {
    const res = await apiClient.post<ApiSuccess<WorkerScaleRequestResult>>('/admin/workers/scale', input);
    return res.data.data;
  },

  /** Histórico de escala, mais recentes primeiro. Só o cursor opaco: nunca `limit`/`offset`. */
  async listScaleEvents(cursor?: string | null): Promise<WorkerScaleEventsPage> {
    const res = await apiClient.get<ApiSuccess<WorkerScaleEventsPage>>('/admin/workers/scale/events', {
      params: cursor ? { cursor } : undefined,
    });
    return res.data.data;
  },
};
