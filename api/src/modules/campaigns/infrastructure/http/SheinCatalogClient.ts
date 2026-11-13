import { logger } from '../../../../shared/logger/logger';
import {
  AffiliateApiUnavailableError,
  AffiliateCredentialRejectedError,
  OfferInvalidInputError,
} from '../../../../shared/errors/internal/OfferErrors';
import { parsePriceToCents } from '../../domain/services/parseProductPage';
import { parseSalesBucket } from '../../domain/services/hunter/parseSalesBucket';
import { HUNTER_LIMITS } from '../../domain/services/hunter/hunterLimits';
import type { HuntCandidate, HuntCommissionBand, HuntSort } from '../../domain/hunter/HuntCandidate';
import type {
  ISheinCatalogClient,
  SheinCatalogCategory,
  SheinCatalogPage,
  SheinCatalogQuery,
  SheinCatalogSearchQuery,
  SheinSession,
} from '../../domain/contracts/ISheinCatalogClient';
import { USER_AGENT } from './HttpShortLinkExpander';

const log = logger.child({ module: 'SheinCatalogClient' });

// Lista fechada (docs/afiliado-shein.md): URLs fixas, nada vem de entrada (sem SSRF).
const BASE = 'https://m.shein.com/br/affiliate/api/seller/activity';
export const SHEIN_CATALOG_ENDPOINTS = {
  category: `${BASE}/category`,
  categoryRate: `${BASE}/categoryRate`,
  list: `${BASE}/goods/list`,
  search: `${BASE}/goods/search`,
} as const;
type Endpoint = keyof typeof SHEIN_CATALOG_ENDPOINTS;

const TIMEOUT_MS = 8_000;
const MAX_BYTES = 256 * 1024;
const PROVIDER = 'SHEIN';
const CODE_OK = '0';
const CODE_NOT_LOGGED = '100105';
/** Observado: a fonte ignora e devolve 10; mandamos o que a página manda. */
const PAGE_SIZE = 20;
const MAX_PAGE = 100;
const GOODS_ID = /^\d{4,12}$/;
const CATEGORY_ID = /^\d{1,12}$/;
const CATEGORY_NAME_MAX = 80;
/** Nome do material sem categoria (1º item de `/category`). */
const ALL_NAME = 'All';
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;
const IMAGE_HOST = 'ltwebstatic.com';
/** Sem fuso no texto: horário do servidor Shein BR, assumido São Paulo (UTC−3 fixo desde 2019, sem horário de verão). */
const SHEIN_SERVER_OFFSET = '-03:00';

/** Códigos observados na página (`sortTypeList`). */
export const SORT_CODE: Record<HuntSort, number> = {
  RECOMMENDED: 0,
  TOP_RATED: 7,
  NEWEST: 9,
  PRICE_ASC: 10,
  PRICE_DESC: 11,
  BEST_SELLING: 12,
};
/** Só 4 confirmado na tela; demais inferidos pela ordem (design §1). */
export const COMM_RATE: Record<HuntCommissionBand, number> = {
  BELOW_5: 1,
  FROM_5_TO_10: 2,
  FROM_10_TO_15: 3,
  ABOVE_15: 4,
  ANY: 5,
};

class BodyTooLargeError extends Error {}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);

function str(v: unknown): string | null {
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

function num(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v.trim().replace('%', '').replace(',', '.')) : NaN;
  return Number.isFinite(n) ? n : null;
}

function pct(v: unknown): number {
  const n = num(v);
  return n === null ? 0 : Math.min(100, Math.max(0, n));
}

function cents(v: unknown): number | null {
  const c = parsePriceToCents(v);
  return c !== null && c >= 0 ? c : null;
}

function imageUrl(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  try {
    const u = new URL(s.startsWith('//') ? `https:${s}` : s);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    const host = u.hostname.toLowerCase();
    if (host !== IMAGE_HOST && !host.endsWith(`.${IMAGE_HOST}`)) return null;
    if (u.username || u.password || u.port) return null;
    u.protocol = 'https:';
    return u.toString();
  } catch {
    return null;
  }
}

/** Epoch (s ou ms), ISO com fuso, ou "AAAA-MM-DD HH:mm[:ss]" no horário de São Paulo. */
export function parseSheinEndTime(v: unknown): Date | null {
  let d: Date | null = null;
  if (typeof v === 'number' || (typeof v === 'string' && /^\d{9,13}$/.test(v.trim()))) {
    const n = Number(v);
    d = Number.isFinite(n) && n > 0 ? new Date(n < 1e11 ? n * 1000 : n) : null;
  } else if (typeof v === 'string') {
    const s = v.trim();
    const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})(:\d{2})?$/.exec(s);
    if (m) d = new Date(`${m[1]}T${m[2]}${m[3] ?? ':00'}${SHEIN_SERVER_OFFSET}`);
    else if (/^\d{4}-\d{2}-\d{2}T.+(Z|[+-]\d{2}:\d{2})$/.test(s)) d = new Date(s);
  }
  return d && Number.isFinite(d.getTime()) ? d : null;
}

/** Item da lista → candidato; null quando não há `goodsId` válido. */
export function mapSheinCatalogItem(raw: unknown): HuntCandidate | null {
  if (!isObj(raw)) return null;
  const goodsId = str(raw.goodsId);
  if (!goodsId || !GOODS_ID.test(goodsId)) return null;
  const priceCents = cents(raw.salesPrice);
  const retail = cents(raw.retailPrice);
  const retailPriceCents = retail !== null && (priceCents === null || retail > priceCents) ? retail : null;
  const discountRaw = num(raw.discount);
  const discountPct =
    discountRaw !== null
      ? Math.round(Math.min(100, Math.max(0, discountRaw)))
      : priceCents !== null && retailPriceCents !== null
        ? Math.round((1 - priceCents / retailPriceCents) * 100)
        : 0;
  const rating = num(raw.commentRankAverage);
  const rank = num(raw.rank);
  const title = str(raw.goodsName);
  const extraCommissionCents = cents(raw.extraCommission) ?? 0;
  return {
    provider: 'SHEIN',
    productId: goodsId,
    skc: str(raw.skcCode),
    activityId: str(raw.activityId),
    title: title ? title.replace(/\s+/g, ' ') : null,
    imageUrl: imageUrl(raw.mainImage),
    priceCents,
    retailPriceCents,
    discountPct,
    commissionNewPct: pct(raw.percentPlatformCommission),
    commissionNewCents: cents(raw.commission) ?? 0,
    commissionReturningPct: pct(raw.percentPlatformCommissionOfOld),
    commissionReturningCents: cents(raw.commissionOfOld) ?? 0,
    extraCommissionCents,
    hasSecondaryCommission: true,
    extraFlag: extraCommissionCents > 0,
    commissionEstimated: false,
    sales: parseSalesBucket(raw.spuSales),
    reviews: parseSalesBucket(raw.commentNum),
    rating: rating !== null && rating >= 0 && rating <= 5 ? rating : null,
    rank: rank !== null && Number.isInteger(rank) && rank >= 1 ? rank : null,
    categoryId: str(raw.categoryId),
    campaignEndsAt: parseSheinEndTime(raw.sellGoodsEndTime),
  };
}

/** Lê no máximo MAX_BYTES; acima disso a resposta é tratada como indisponível. */
async function readLimited(res: Response): Promise<string> {
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw new BodyTooLargeError();
    }
    chunks.push(value);
  }
  return new TextDecoder('utf-8').decode(Buffer.concat(chunks));
}

function unavailable(endpoint: Endpoint, data: Obj, msg: string): never {
  log.warn({ endpoint, ...data }, msg);
  throw new AffiliateApiUnavailableError(PROVIDER);
}

function assertQuery(q: SheinCatalogQuery): void {
  if (!Number.isInteger(q.page) || q.page < 1 || q.page > MAX_PAGE) throw new OfferInvalidInputError('invalid page', 'page');
  if (!isDid(q.did)) throw new OfferInvalidInputError('invalid did', 'did');
  if (q.category !== null) {
    const { categoryId, name } = q.category ?? ({} as { categoryId?: unknown; name?: unknown });
    const okName = typeof name === 'string' && name.trim() !== '' && name.length <= CATEGORY_NAME_MAX && !CONTROL.test(name);
    if (typeof categoryId !== 'string' || !CATEGORY_ID.test(categoryId) || !okName) {
      throw new OfferInvalidInputError('invalid category', 'category');
    }
  }
  if (!(q.sort in SORT_CODE)) throw new OfferInvalidInputError('invalid sort', 'sort');
}

function cleanKeyword(raw: unknown): string {
  const k = typeof raw === 'string' ? raw.trim() : '';
  if (!k || k.length > HUNTER_LIMITS.keywordMaxLength || CONTROL.test(k)) {
    throw new OfferInvalidInputError('invalid keyword', 'keyword');
  }
  return k;
}

const isDid = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v > 0;

/** `info.materialInfoList` (category e categoryRate); fora desse formato → null. */
function materialInfoList(json: Obj): unknown[] | null {
  const info = json.info;
  return isObj(info) && Array.isArray(info.materialInfoList) ? info.materialInfoList : null;
}

/** `{ name, cateId: string|null, did: number }`; "All" vem com cateId null. Inválido → null. */
function mapMaterialInfo(x: unknown): SheinCatalogCategory | null {
  if (!isObj(x) || !isDid(x.did)) return null;
  const name = typeof x.name === 'string' ? x.name.replace(/\s+/g, ' ').trim() : '';
  if (!name || name.length > CATEGORY_NAME_MAX || CONTROL.test(name)) return null;
  let categoryId: string | null = null;
  if (x.cateId !== null) {
    const id = typeof x.cateId === 'string' ? x.cateId : typeof x.cateId === 'number' ? String(x.cateId) : '';
    if (!CATEGORY_ID.test(id)) return null;
    categoryId = id;
  }
  return { categoryId, name, did: x.did };
}

/** Exatamente o objeto da página: `name` "All" ou o da categoria; `contextParam` espelha `cateId` (string). */
function materialInfoInfo(q: SheinCatalogQuery): Obj {
  const cateId = q.category ? q.category.categoryId : null;
  return {
    name: q.category ? q.category.name : ALL_NAME,
    cateId,
    did: q.did,
    contextParam: { filterCateId: cateId, cateId },
  };
}

export class SheinCatalogClient implements ISheinCatalogClient {
  /** Nunca loga token, memberId, palavra-chave, corpo ou URL: só endpoint (nome), status e código. */
  private async post(endpoint: Endpoint, session: SheinSession, body: Obj): Promise<Obj> {
    let res: Response;
    try {
      res = await fetch(SHEIN_CATALOG_ENDPOINTS[endpoint], {
        method: 'POST',
        // Exatos: nenhum header anti-bot (docs/afiliado-shein.md)
        headers: {
          token: session.token,
          siteuid: 'mbr',
          language: 'pt-br',
          mi: session.memberId,
          channel: '1',
          'content-type': 'application/json',
          'User-Agent': USER_AGENT,
        },
        body: JSON.stringify(body),
        redirect: 'manual',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      return unavailable(endpoint, { reason: (err as Error)?.name }, 'Shein catálogo sem resposta');
    }

    // Mesma régua do SheinAffiliateClient: 401 ou 403+100105 = sessão; 403 sem o código = WAF/IP → indisponível
    if (res.status === 401) {
      await res.body?.cancel().catch(() => undefined);
      log.warn({ endpoint, status: res.status }, 'Shein recusou a sessão');
      throw new AffiliateCredentialRejectedError(PROVIDER);
    }
    if (res.status === 403) {
      let forbiddenCode: string | null = null;
      try {
        const j = JSON.parse(await readLimited(res)) as { code?: unknown };
        forbiddenCode = j && j.code !== undefined && j.code !== null ? String(j.code) : null;
      } catch {
        forbiddenCode = null;
      }
      if (forbiddenCode === CODE_NOT_LOGGED) {
        log.warn({ endpoint, status: res.status, code: forbiddenCode }, 'Shein recusou a sessão');
        throw new AffiliateCredentialRejectedError(PROVIDER);
      }
      return unavailable(endpoint, { status: res.status, code: forbiddenCode }, 'Shein catálogo bloqueou');
    }
    if (res.status >= 300 || res.type === 'opaqueredirect') {
      await res.body?.cancel().catch(() => undefined);
      return unavailable(endpoint, { status: res.status }, 'Shein catálogo falhou');
    }

    let json: unknown;
    try {
      json = JSON.parse(await readLimited(res));
    } catch (err) {
      return unavailable(endpoint, { status: res.status, reason: err instanceof BodyTooLargeError ? 'too_large' : 'invalid_json' }, 'Shein catálogo resposta ilegível');
    }
    if (!isObj(json)) return unavailable(endpoint, { reason: 'not_object' }, 'Shein catálogo resposta ilegível');

    const code = json.code === undefined || json.code === null ? null : String(json.code);
    if (code === CODE_NOT_LOGGED) {
      log.warn({ endpoint, code }, 'Shein recusou a sessão');
      throw new AffiliateCredentialRejectedError(PROVIDER);
    }
    if (code !== CODE_OK) return unavailable(endpoint, { code }, 'Shein catálogo devolveu código inesperado');
    return json;
  }

  async listCategories(session: SheinSession): Promise<SheinCatalogCategory[]> {
    const json = await this.post('category', session, {});
    const list = materialInfoList(json);
    if (!list) return unavailable('category', { reason: 'no_material_list' }, 'Shein catálogo sem categorias');
    const out: SheinCatalogCategory[] = [];
    for (const x of list) {
      const m = mapMaterialInfo(x);
      if (m) out.push(m);
    }
    return out;
  }

  /** Faixa → `info.materialInfoList[0].did`; esse `did` substitui o de `materialInfoInfo`. */
  async resolveCommissionBand(session: SheinSession, band: HuntCommissionBand): Promise<number> {
    const commRate = COMM_RATE[band];
    if (commRate === undefined) throw new OfferInvalidInputError('invalid band', 'commissionBand');
    const json = await this.post('categoryRate', session, { commRate });
    const first = materialInfoList(json)?.[0];
    const did = isObj(first) ? first.did : undefined;
    if (!isDid(did)) return unavailable('categoryRate', { reason: 'no_did' }, 'Shein catálogo sem did da faixa');
    return did;
  }

  async list(session: SheinSession, query: SheinCatalogQuery): Promise<SheinCatalogPage> {
    assertQuery(query);
    return this.page('list', session, {
      pageNum: query.page,
      pageSize: PAGE_SIZE,
      sort: SORT_CODE[query.sort],
      materialInfoInfo: materialInfoInfo(query),
      randomShow: false,
    });
  }

  async search(session: SheinSession, query: SheinCatalogSearchQuery): Promise<SheinCatalogPage> {
    const searchKey = cleanKeyword(query.keyword);
    assertQuery(query);
    // Igual ao da página: sem `randomShow`
    return this.page('search', session, {
      searchKey,
      pageNum: query.page,
      pageSize: PAGE_SIZE,
      materialInfoInfo: materialInfoInfo(query),
      sort: SORT_CODE[query.sort],
    });
  }

  private async page(endpoint: 'list' | 'search', session: SheinSession, body: Obj): Promise<SheinCatalogPage> {
    const json = await this.post(endpoint, session, body);
    const info = json.info;
    // `goodsList: null` com code 0 = sintoma de header faltando: fonte indisponível, nunca "nenhuma oferta"
    if (!isObj(info) || !Array.isArray(info.goodsList)) return unavailable(endpoint, { reason: 'goods_list_null' }, 'Shein catálogo sem lista');
    if (typeof info.total !== 'number' || !Number.isFinite(info.total) || info.total < 0 || typeof info.hasNextPage !== 'boolean') {
      return unavailable(endpoint, { reason: 'unexpected_page_shape' }, 'Shein catálogo fora do formato');
    }
    const items: HuntCandidate[] = [];
    let dropped = 0;
    for (const raw of info.goodsList) {
      const c = mapSheinCatalogItem(raw);
      if (c) items.push(c);
      else dropped += 1;
    }
    if (dropped) log.warn({ endpoint, dropped }, 'Shein catálogo: itens sem goodsId válido descartados');
    return { items, hasNextPage: info.hasNextPage, total: Math.floor(info.total) };
  }
}
