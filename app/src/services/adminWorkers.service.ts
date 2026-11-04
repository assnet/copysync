import { apiClient } from './apiClient';
import type { ApiSuccess } from '@/types/api.types';
import type { WorkerOccupancyList } from '@/features/workersAdmin/types';

/** Ocupação dos workers — rota só de super admin. */
export const adminWorkersService = {
  async list(): Promise<WorkerOccupancyList> {
    const res = await apiClient.get<ApiSuccess<WorkerOccupancyList>>('/admin/workers');
    return res.data.data;
  },
};
