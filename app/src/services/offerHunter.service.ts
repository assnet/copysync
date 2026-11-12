import { apiClient } from './apiClient';
import type { ApiSuccess } from '@/types/api.types';
import type {
  CreateHuntInput, HunterSettings, Hunt, HuntApproveResult, HuntFind, HuntOptions, HuntPage, HuntRun, HuntRunResult,
  HuntUsage, SaveHunterSettingsInput, UpdateHuntInput,
} from '@/features/offerHunter/types';

const BASE = '/offer-hunts';

const enc = encodeURIComponent;
/** Só o cursor opaco vai na query (tamanho da página é do servidor). */
const pageParams = (cursor?: string | null) => (cursor ? { params: { cursor } } : undefined);

/**
 * Caçador de Ofertas (contrato em `api/src/modules/campaigns/presentation/routes/offerHunt.routes.ts`).
 * Fora da audiência: 403 `OFFER_HUNTER_UNAVAILABLE` em tudo menos `/access`. Erros: `offerHunterStrings.errors`.
 */
export const offerHunterService = {
  /** Visibilidade do menu e da rota. Nunca 403. */
  async getAccess(): Promise<{ visible: boolean }> {
    const res = await apiClient.get<ApiSuccess<{ visible: boolean }>>(`${BASE}/access`);
    return res.data.data;
  },

  async getUsage(): Promise<HuntUsage> {
    const res = await apiClient.get<ApiSuccess<HuntUsage>>(`${BASE}/usage`);
    return res.data.data;
  },

  async getOptions(): Promise<HuntOptions> {
    const res = await apiClient.get<ApiSuccess<HuntOptions>>(`${BASE}/options`);
    return res.data.data;
  },

  async getSettings(): Promise<HunterSettings> {
    const res = await apiClient.get<ApiSuccess<HunterSettings>>(`${BASE}/settings`);
    return res.data.data;
  },

  async saveSettings(body: SaveHunterSettingsInput): Promise<HunterSettings> {
    const res = await apiClient.put<ApiSuccess<HunterSettings>>(`${BASE}/settings`, body);
    return res.data.data;
  },

  async list(): Promise<Hunt[]> {
    const res = await apiClient.get<ApiSuccess<Hunt[]>>(BASE);
    return res.data.data;
  },

  /** 409 `OFFER_HUNT_LIMIT_REACHED` acima de `limits.huntsMax`; 422 `OFFER_INVALID_INPUT` com `meta.field`. */
  async create(body: CreateHuntInput): Promise<Hunt> {
    const res = await apiClient.post<ApiSuccess<Hunt>>(BASE, body);
    return res.data.data;
  },

  async get(id: string): Promise<Hunt> {
    const res = await apiClient.get<ApiSuccess<Hunt>>(`${BASE}/${enc(id)}`);
    return res.data.data;
  },

  async update(id: string, body: UpdateHuntInput): Promise<Hunt> {
    const res = await apiClient.put<ApiSuccess<Hunt>>(`${BASE}/${enc(id)}`, body);
    return res.data.data;
  },

  /** O histórico (execuções e achados) fica. */
  async remove(id: string): Promise<void> {
    await apiClient.delete(`${BASE}/${enc(id)}`);
  },

  async pause(id: string): Promise<Hunt> {
    const res = await apiClient.post<ApiSuccess<Hunt>>(`${BASE}/${enc(id)}/pause`);
    return res.data.data;
  },

  async resume(id: string): Promise<Hunt> {
    const res = await apiClient.post<ApiSuccess<Hunt>>(`${BASE}/${enc(id)}/resume`);
    return res.data.data;
  },

  /** "Testar agora": ranking com fatores. 429 `OFFER_HUNT_RUN_THROTTLED`/`RATE_LIMITED`. */
  async run(id: string): Promise<HuntRunResult> {
    const res = await apiClient.post<ApiSuccess<HuntRunResult>>(`${BASE}/${enc(id)}/run`);
    return res.data.data;
  },

  /** 400 `OFFER_HUNT_CURSOR_INVALID` com cursor velho: recomeçar sem cursor. */
  async listRuns(id: string, cursor?: string | null): Promise<HuntPage<HuntRun>> {
    const res = await apiClient.get<ApiSuccess<HuntPage<HuntRun>>>(`${BASE}/${enc(id)}/runs`, pageParams(cursor));
    return res.data.data;
  },

  async listFinds(id: string, cursor?: string | null): Promise<HuntPage<HuntFind>> {
    const res = await apiClient.get<ApiSuccess<HuntPage<HuntFind>>>(`${BASE}/${enc(id)}/finds`, pageParams(cursor));
    return res.data.data;
  },

  /** Envia o achado ao grupo de destino. 409 `OFFER_HUNT_FIND_INVALID_STATE` se já decidido. */
  async approveFind(findId: string): Promise<HuntApproveResult> {
    const res = await apiClient.post<ApiSuccess<HuntApproveResult>>(`${BASE}/finds/${enc(findId)}/approve`);
    return res.data.data;
  },

  async dismissFind(findId: string): Promise<HuntFind> {
    const res = await apiClient.post<ApiSuccess<HuntFind>>(`${BASE}/finds/${enc(findId)}/dismiss`);
    return res.data.data;
  },
};
