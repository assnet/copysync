import { apiClient } from './apiClient';
import { filenameFromDisposition } from './saver.service';
import type { ApiSuccess } from '@/types/api.types';
import type {
  PlatformContactDetail, PlatformContactFilters, PlatformContactsFile, PlatformContactsPage, PlatformContactsSummary,
  PlatformTenantsPage,
} from '@/features/saverAdmin/types';

const BASE = '/admin/saver';

/** `YYYY-MM-DD` local → ISO. `to` cobre o dia inteiro. Vazio = sem filtro. */
function dayToIso(day: string, endOfDay: boolean): string | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return undefined;
  const d = new Date(`${day}T${endOfDay ? '23:59:59.999' : '00:00:00'}`);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

/** Filtros no formato da API: só os preenchidos. Nunca `limit`/`offset` (a página é do servidor). */
export function toPlatformFilterParams(f: PlatformContactFilters): Record<string, string> {
  const out: Record<string, string> = {};
  const search = f.search.trim();
  if (search) out.search = search.slice(0, 100);
  if (f.tenantId) out.tenantId = f.tenantId;
  const from = dayToIso(f.from, false);
  const to = dayToIso(f.to, true);
  if (from) out.from = from;
  if (to) out.to = to;
  if (/^\d{1,3}$/.test(f.ddi)) {
    out.ddi = f.ddi;
    // DDD só existe no Brasil: a API recusa DDD com outro DDI.
    if (f.ddi === '55' && /^\d{2}$/.test(f.ddd)) out.ddd = f.ddd;
  }
  return out;
}

/**
 * Base de contatos da plataforma (só super admin; a API recusa os demais com 403). Lista por cursor
 * assinado: a próxima página manda os mesmos filtros + o `nextCursor` recebido, nada mais. Cursor
 * inválido = 400 `SAVER_CURSOR_INVALID` (a tela recomeça da 1ª página).
 */
export const saverAdminService = {
  async listContacts(filters: PlatformContactFilters, cursor: string | null): Promise<PlatformContactsPage> {
    const params = { ...toPlatformFilterParams(filters), ...(cursor ? { cursor } : {}) };
    const res = await apiClient.get<ApiSuccess<PlatformContactsPage>>(`${BASE}/contacts`, { params });
    return res.data.data;
  },

  /** Indicadores (contagens) com os mesmos filtros da lista, sem cursor. Leitura lenta = 503. */
  async getSummary(filters: PlatformContactFilters): Promise<PlatformContactsSummary> {
    const res = await apiClient.get<ApiSuccess<PlatformContactsSummary>>(`${BASE}/contacts/summary`, { params: toPlatformFilterParams(filters) });
    return res.data.data;
  },

  async getContact(id: string): Promise<PlatformContactDetail> {
    const res = await apiClient.get<ApiSuccess<PlatformContactDetail>>(`${BASE}/contacts/${encodeURIComponent(id)}`);
    return res.data.data;
  },

  /** Contas com vínculo na base, para o filtro. Só o cursor recebido; nunca `limit`. */
  async listTenants(cursor: string | null): Promise<PlatformTenantsPage> {
    const res = await apiClient.get<ApiSuccess<PlatformTenantsPage>>(`${BASE}/tenants`, { params: cursor ? { cursor } : {} });
    return res.data.data;
  },

  /** CSV por stream (auditado). Com `responseType: 'blob'` o erro chega só com `status`. */
  async exportContacts(filters: PlatformContactFilters, fallbackName: string): Promise<PlatformContactsFile> {
    const res = await apiClient.post<Blob>(`${BASE}/exports`, toPlatformFilterParams(filters), { responseType: 'blob' });
    return { blob: res.data, filename: filenameFromDisposition(res.headers?.['content-disposition'], fallbackName) };
  },
};
