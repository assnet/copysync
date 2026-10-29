import { apiClient } from './apiClient';
import type { ApiSuccess } from '@/types/api.types';
import type {
  CreateLinkDomainRequest,
  LinkDomain,
  LinkDomainProbeResult,
  UpdateLinkDomainRequest,
} from '@/features/linkDomainsAdmin/types';

const BASE = '/admin/link-domains';

/** Domínios base do rodízio de links — rotas só de super admin (sem super admin a API devolve 401). */
export const adminLinkDomainsService = {
  async list(): Promise<LinkDomain[]> {
    const res = await apiClient.get<ApiSuccess<{ items: LinkDomain[] }>>(BASE);
    return res.data.data.items;
  },

  async create(body: CreateLinkDomainRequest): Promise<LinkDomain> {
    const res = await apiClient.post<ApiSuccess<LinkDomain>>(BASE, body);
    return res.data.data;
  },

  async update(id: string, body: UpdateLinkDomainRequest): Promise<LinkDomain> {
    const res = await apiClient.patch<ApiSuccess<LinkDomain>>(`${BASE}/${encodeURIComponent(id)}`, body);
    return res.data.data;
  },

  async remove(id: string): Promise<void> {
    await apiClient.delete(`${BASE}/${encodeURIComponent(id)}`);
  },

  /** Testa DNS + certificado + roteamento num subdomínio aleatório do domínio. */
  async probe(id: string): Promise<LinkDomainProbeResult> {
    const res = await apiClient.post<ApiSuccess<LinkDomainProbeResult>>(`${BASE}/${encodeURIComponent(id)}/probe`, {});
    return res.data.data;
  },
};
