import { apiClient } from './apiClient';
import type { ApiSuccess } from '@/types/api.types';
import type {
  CreateRotationInput,
  RenameRotationInput,
  Rotation,
  RotationGroup,
  RotationGroupCandidates,
  RotationOverview,
  RotationStats,
  SaveRotationGroupInput,
  UpdateRotationInput,
} from '@/features/linkRotation/types';

const BASE = '/link-rotation';
const one = (id: string) => `${BASE}/${encodeURIComponent(id)}`;

/** Rodízio de links do tenant (contrato em `.specs/features/link-rotation/api-contract.md`). */
export const linkRotationService = {
  /** Rodízios, domínios ativos, limites do plano e sessões do tenant. */
  async getOverview(): Promise<RotationOverview> {
    const res = await apiClient.get<ApiSuccess<RotationOverview>>(BASE);
    return res.data.data;
  },

  /** Recusa com `PLAN_LIMIT_REACHED` (limite de rodízios) ou `LINK_SLUG_*`. */
  async create(body: CreateRotationInput): Promise<Rotation> {
    const res = await apiClient.post<ApiSuccess<Rotation>>(BASE, body);
    return res.data.data;
  },

  async update(id: string, body: UpdateRotationInput): Promise<Rotation> {
    const res = await apiClient.patch<ApiSuccess<Rotation>>(one(id), body);
    return res.data.data;
  },

  /** Troca o nome (slug) e opcionalmente o domínio; o antigo fica reservado ao tenant. */
  async rename(id: string, body: RenameRotationInput): Promise<Rotation> {
    const res = await apiClient.post<ApiSuccess<Rotation>>(`${one(id)}/rename`, body);
    return res.data.data;
  },

  async remove(id: string): Promise<void> {
    await apiClient.delete(one(id));
  },

  /** Grupos da sessão do rodízio, com os já escolhidos marcados. */
  async listGroups(id: string, search?: string): Promise<RotationGroupCandidates> {
    const q = search?.trim();
    const res = await apiClient.get<ApiSuccess<RotationGroupCandidates>>(`${one(id)}/groups`, {
      params: q ? { search: q } : undefined,
    });
    return res.data.data;
  },

  /** Substitui a lista inteira; ordem do array = posição quando `position` não vier. */
  async saveGroups(id: string, groups: SaveRotationGroupInput[]): Promise<RotationGroup[]> {
    const res = await apiClient.put<ApiSuccess<{ groups: RotationGroup[] }>>(`${one(id)}/groups`, { groups });
    return res.data.data.groups;
  },

  /** Relê convite e membros de um grupo agora. */
  async refreshGroup(id: string, groupId: string): Promise<RotationGroup> {
    const res = await apiClient.post<ApiSuccess<RotationGroup>>(`${one(id)}/groups/${encodeURIComponent(groupId)}/refresh`, {});
    return res.data.data;
  },

  async getStats(id: string): Promise<RotationStats> {
    const res = await apiClient.get<ApiSuccess<RotationStats>>(`${one(id)}/stats`);
    return res.data.data;
  },
};
