import { apiClient } from './apiClient';
import type { ChangePasswordRequest } from '@/types/api.types';

export const accountService = {
  async changePassword(data: ChangePasswordRequest): Promise<void> {
    await apiClient.patch('/me/password', data);
  },
};
