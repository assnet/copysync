import { apiClient } from './apiClient';
import type { ApiSuccess } from '@/types/api.types';
import type {
  CreateHuntInput, HunterSettings, Hunt, HuntAiSuggestInput, HuntAiSuggestion, HuntApproveResult, HuntFind, HuntOptions,
  HuntPage, HuntProvider, HuntProviderState, HuntRun, HuntRunResult, HuntUsage, SaveHunterSettingsInput, UpdateHuntInput,
} from '@/features/offerHunter/types';

const BASE = '/offer-hunts';
/**
 * A sugestão da IA lê a loja e chama o provedor: pode levar dezenas de segundos. Corta antes dos 100 s do proxy
 * da API (que devolveria erro sem código) para a tela dizer "demorou" em vez de erro genérico.
 */
export const HUNT_AI_SUGGEST_TIMEOUT_MS = 95_000;

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

  /** Capacidades, categorias, predefinições, limites e portões **da loja** (padrão SHEIN). */
  async getOptions(provider: HuntProvider = 'SHEIN'): Promise<HuntOptions> {
    const res = await apiClient.get<ApiSuccess<HuntOptions>>(`${BASE}/options`, { params: { provider } });
    return res.data.data;
  },

  /** Portões de todas as lojas numa chamada leve (sem chamar a fonte): passo 0 do assistente. */
  async getProviders(): Promise<HuntProviderState[]> {
    const res = await apiClient.get<ApiSuccess<{ items: HuntProviderState[] }>>(`${BASE}/options/providers`);
    return res.data.data.items;
  },

  /**
   * IA sugere a configuração (nada salvo). 429 `OFFER_HUNT_AI_SUGGEST_DAILY_LIMIT`, 409 `AI_NOT_CONFIGURED`,
   * 422 `OFFER_HUNT_AI_SUGGEST_INPUT_REQUIRED`/`_INVALID_OUTPUT`, 503 `_PROVIDER_UNAVAILABLE`, 403 plano; do gerador de
   * IA: 503 `AI_PROVIDER_UNAVAILABLE`, 429 `AI_PROVIDER_RATE_LIMITED`/`AI_DAILY_LIMIT_REACHED`, 422 `AI_PROVIDER_REJECTED`.
   */
  async suggestConfig(body: HuntAiSuggestInput): Promise<HuntAiSuggestion> {
    const res = await apiClient.post<ApiSuccess<HuntAiSuggestion>>(`${BASE}/ai-suggest`, body, { timeout: HUNT_AI_SUGGEST_TIMEOUT_MS });
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

  /** Execução completa com `ranking` (null = não guardado); a lista de execuções não traz o ranking. */
  async getRun(huntId: string, runId: string): Promise<HuntRun> {
    const res = await apiClient.get<ApiSuccess<HuntRun>>(`${BASE}/${enc(huntId)}/runs/${enc(runId)}`);
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

  /** Reenvio de achado já entregue (não conta no teto do dia). */
  async resendFind(findId: string): Promise<HuntFind> {
    const res = await apiClient.post<ApiSuccess<HuntFind>>(`${BASE}/finds/${enc(findId)}/resend`);
    return res.data.data;
  },

  async dismissFind(findId: string): Promise<HuntFind> {
    const res = await apiClient.post<ApiSuccess<HuntFind>>(`${BASE}/finds/${enc(findId)}/dismiss`);
    return res.data.data;
  },
};
