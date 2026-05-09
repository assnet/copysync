import { apiClient } from './apiClient';
import type { LoginRequest, LoginResponse, RefreshResponse } from '@/types/api.types';

export const authService = {
  async login(data: LoginRequest): Promise<LoginResponse> {
    const res = await apiClient.post<{ success: true; data: LoginResponse }>('/auth/login', data);
    return res.data.data;
  },

  async refresh(refreshToken: string): Promise<RefreshResponse> {
    const res = await apiClient.post<{ success: true; data: RefreshResponse }>('/auth/refresh', {
      refreshToken,
    });
    return res.data.data;
  },

  async logout(refreshToken: string): Promise<void> {
    await apiClient.post('/auth/logout', { refreshToken });
  },
};
