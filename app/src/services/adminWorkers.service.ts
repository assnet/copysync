import { apiClient } from './apiClient';
import type { ApiSuccess } from '@/types/api.types';
import type {
  UpdateWorkerScalingSettingsInput,
  WorkerOccupancyList,
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
};
