import { apiClient } from './apiClient';
import type { ApiSuccess } from '@/types/api.types';
import type {
  RequestSaverExtractionInput, SaverAccess, SaverConfigDetails, SaverExportFile, SaverExportGrant, SaverExportGrantUpdate, SaverExportInput,
  SaverExtraction, SaverGroup, SaverOverview, SaverSessionGroup, UpdateSaverConfigInput,
} from '@/features/saver/types';

const BASE = '/saver';
const enc = encodeURIComponent;

/** Nome do arquivo em `Content-Disposition` (`filename*=UTF-8''…` tem prioridade); sem cabeçalho, o padrão. */
export function filenameFromDisposition(header: unknown, fallback: string): string {
  if (typeof header !== 'string') return fallback;
  const star = /filename\*\s*=\s*UTF-8''([^;]+)/i.exec(header);
  if (star?.[1]) {
    try {
      return decodeURIComponent(star[1].trim());
    } catch {
      /* cai no filename simples */
    }
  }
  const plain = /filename\s*=\s*"?([^";]+)"?/i.exec(header);
  return plain?.[1]?.trim() || fallback;
}

/**
 * Saver (contrato em `.specs/features/saver/design.md` §4.5). Única porta HTTP do produto no painel.
 * Fora do produto: 403 `PRODUCT_UNAVAILABLE` (o `apiClient` leva à vitrine); fora da audiência: 403
 * `SAVER_UNAVAILABLE` em tudo menos `/access`. Erros traduzidos em `features/saver/errors.ts`.
 */
export const saverService = {
  /** Visibilidade do Saver no menu (audiência). Nunca 403. */
  async getAccess(): Promise<SaverAccess> {
    const res = await apiClient.get<ApiSuccess<SaverAccess>>(`${BASE}/access`);
    return res.data.data;
  },

  async getOverview(): Promise<SaverOverview> {
    const res = await apiClient.get<ApiSuccess<SaverOverview>>(`${BASE}/overview`);
    return res.data.data;
  },

  /** Grupos ao vivo da sessão. `SESSION_NOT_CONNECTED` / `ENGINE_OPERATION_UNSUPPORTED` (Telegram). */
  async listSessionGroups(sessionId: string): Promise<SaverSessionGroup[]> {
    const res = await apiClient.get<ApiSuccess<SaverSessionGroup[]>>(`${BASE}/sessions/${enc(sessionId)}/groups`);
    return res.data.data;
  },

  /** 403 `PLAN_LIMIT_REACHED` (`meta.key`, `meta.limit`) antes de gravar. */
  async requestExtraction(body: RequestSaverExtractionInput): Promise<SaverExtraction> {
    const res = await apiClient.post<ApiSuccess<SaverExtraction>>(`${BASE}/extractions`, body);
    return res.data.data;
  },

  async getExtraction(id: string): Promise<SaverExtraction> {
    const res = await apiClient.get<ApiSuccess<SaverExtraction>>(`${BASE}/extractions/${enc(id)}`);
    return res.data.data;
  },

  /** Cancela o que ainda está na fila; devolve a extração atualizada. */
  async cancelExtraction(id: string): Promise<SaverExtraction> {
    const res = await apiClient.post<ApiSuccess<{ extraction: SaverExtraction; cancelledItems: number }>>(`${BASE}/extractions/${enc(id)}/cancel`);
    return res.data.data.extraction;
  },

  async listGroups(): Promise<SaverGroup[]> {
    const res = await apiClient.get<ApiSuccess<SaverGroup[]>>(`${BASE}/groups`);
    return res.data.data;
  },

  async removeGroup(id: string): Promise<void> {
    await apiClient.delete(`${BASE}/groups/${enc(id)}`);
  },

  /** Só `ADMIN`. */
  async listExportGrants(): Promise<SaverExportGrant[]> {
    const res = await apiClient.get<ApiSuccess<SaverExportGrant[]>>(`${BASE}/permissions`);
    return res.data.data;
  },

  async setExportGrant(userId: string, allowed: boolean): Promise<SaverExportGrantUpdate> {
    const res = await apiClient.put<ApiSuccess<SaverExportGrantUpdate>>(`${BASE}/permissions/${enc(userId)}`, { export: allowed });
    return res.data.data;
  },

  async getConfig(): Promise<SaverConfigDetails> {
    const res = await apiClient.get<ApiSuccess<SaverConfigDetails>>(`${BASE}/config`);
    return res.data.data;
  },

  async updateConfig(body: UpdateSaverConfigInput): Promise<SaverConfigDetails> {
    const res = await apiClient.put<ApiSuccess<SaverConfigDetails>>(`${BASE}/config`, body);
    return res.data.data;
  },

  /**
   * Arquivo por stream. Com `responseType: 'blob'` o corpo do erro não é lido: a tela decide pelo
   * `status` (422 = vazio, 403 = sem permissão ou limite).
   */
  async exportContacts(body: SaverExportInput): Promise<SaverExportFile> {
    const res = await apiClient.post<Blob>(`${BASE}/exports`, body, { responseType: 'blob' });
    const fallback = body.format === 'VCARD' ? 'contatos.vcf' : 'contatos.csv';
    return { blob: res.data, filename: filenameFromDisposition(res.headers?.['content-disposition'], fallback) };
  },
};
