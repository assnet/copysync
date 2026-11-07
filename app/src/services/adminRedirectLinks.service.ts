import { apiClient } from './apiClient';
import type { ApiSuccess } from '@/types/api.types';
import type { CreateRedirectLinkRequest, RedirectLink, UpdateRedirectLinkRequest } from '@/features/redirectLinks/types';

const BASE = '/admin/redirect-links';

/** Links de redirecionamento da plataforma — rotas só de super admin (sem super admin a API devolve 401). */
export const adminRedirectLinksService = {
  async list(): Promise<RedirectLink[]> {
    const res = await apiClient.get<ApiSuccess<{ items: RedirectLink[] }>>(BASE);
    return res.data.data.items;
  },

  async create(body: CreateRedirectLinkRequest): Promise<RedirectLink> {
    const res = await apiClient.post<ApiSuccess<RedirectLink>>(BASE, body);
    return res.data.data;
  },

  async update(id: string, body: UpdateRedirectLinkRequest): Promise<RedirectLink> {
    const res = await apiClient.patch<ApiSuccess<RedirectLink>>(`${BASE}/${encodeURIComponent(id)}`, body);
    return res.data.data;
  },

  async remove(id: string): Promise<void> {
    await apiClient.delete(`${BASE}/${encodeURIComponent(id)}`);
  },
};
