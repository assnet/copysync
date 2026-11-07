import { apiClient } from './apiClient';
import type { ApiSuccess } from '@/types/api.types';

/** Resolução pública (sem login) do link da plataforma: A/B sorteado e clique contado na API. */
export const publicRedirectService = {
  async resolve(slug: string): Promise<string> {
    const res = await apiClient.get<ApiSuccess<{ url: string }>>(`/public/redirects/${encodeURIComponent(slug)}`);
    return res.data.data.url;
  },
};
