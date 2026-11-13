// Fonte do Caçador no Mercado Livre: lista do hub de afiliados (`POST /affiliate-program/api/hub/search`), observada
// em 2026-11-13 e sondada da Render (docs/extensao-ml-endpoints.md, "Hub de afiliados — busca"). Mesmo caminho do
// `createLink`: bootstrap `/afiliados/linkbuilder` com o `ssid` → `_csrf`; POST com os mesmos headers.
// Nunca loga cookie, token, palavra-chave, corpo ou URL: só status/código/motivo.
import { logger } from '../../../../shared/logger/logger';
import {
  AffiliateApiRateLimitedError,
  AffiliateApiUnavailableError,
  AffiliateCredentialRejectedError,
  OfferInvalidInputError,
} from '../../../../shared/errors/internal/OfferErrors';
import type {
  HuntSourceCategory,
  HuntSourcePage,
  HuntSourceQuery,
  HuntSourceSession,
  IHuntCatalogSource,
} from '../../domain/hunter/HuntProvider';
import { HUNTER_LIMITS } from '../../domain/services/hunter/hunterLimits';
import { MERCADO_LIVRE_HUNT_SORTS } from '../../domain/services/hunter/mercadoLivreCapabilities';
import {
  ML_CONTROL_CHARS,
  MERCADO_LIVRE_CATEGORY_ID,
  parseMercadoLivreHubCategories,
  parseMercadoLivreHubPage,
} from '../../domain/services/hunter/mercadoLivreHubMapper';
import {
  ML_BASE,
  ML_PROVIDER,
  ML_TIMEOUT_MS,
  ML_USER_AGENT,
  bootstrapMercadoLivreSession,
  buildCookieHeader,
  isMlLoginPage,
} from './mercadoLivreBootstrap';

const log = logger.child({ module: 'MlHubClient' });

// URL fixa (allowlist `www.mercadolivre.com.br`): nada da entrada entra na URL.
export const ML_HUB_SEARCH_URL = `${ML_BASE}/affiliate-program/api/hub/search?is_affiliate=true&device=desktop`;
export const ML_HUB_REFERER = `${ML_BASE}/afiliados/hub?is_affiliate=true`;
/** Cartões por página observados (offset anda de 18 em 18). */
export const ML_HUB_PAGE_SIZE = 18;
const MAX_PAGE = 50;
const MAX_BYTES = 256 * 1024;

type HubFilter = { id: 'best_seller' | 'extra_commission'; value: true } | { id: 'category'; value: string };
interface HubSearchBody {
  search: string;
  sort: string;
  filters: HubFilter[];
  offset: number;
}

class BodyTooLargeError extends Error {}

function unavailable(data: Record<string, unknown>, msg: string): never {
  log.warn(data, msg);
  throw new AffiliateApiUnavailableError(ML_PROVIDER);
}

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

function sessionCookies(session: HuntSourceSession): Record<string, string> {
  if (session.provider !== 'MERCADO_LIVRE') throw new OfferInvalidInputError('invalid session', 'session');
  return session.cookies;
}

/** Corpo exato da página do hub (ordem dos filtros: mais vendidos, ganhos extras, categoria). */
export function buildHubSearchBody(query: HuntSourceQuery): HubSearchBody {
  if (!Number.isInteger(query.page) || query.page < 1 || query.page > MAX_PAGE) {
    throw new OfferInvalidInputError('invalid page', 'page');
  }
  let search = '';
  if (query.keyword !== null && query.keyword !== undefined) {
    const k = typeof query.keyword === 'string' ? query.keyword.trim() : '';
    if (k.length > HUNTER_LIMITS.keywordMaxLength || ML_CONTROL_CHARS.test(k)) {
      throw new OfferInvalidInputError('invalid keyword', 'keyword');
    }
    search = k;
  }
  const sort = query.options?.sort ?? 'relevance';
  if (!(MERCADO_LIVRE_HUNT_SORTS as readonly string[]).includes(sort)) throw new OfferInvalidInputError('invalid sort', 'sort');

  const filters: HubFilter[] = [];
  if (query.options?.bestSellersOnly) filters.push({ id: 'best_seller', value: true });
  if (query.options?.extraEarningsOnly) filters.push({ id: 'extra_commission', value: true });
  const categoryId = query.category?.categoryId ?? null;
  if (categoryId !== null) {
    if (typeof categoryId !== 'string' || !MERCADO_LIVRE_CATEGORY_ID.test(categoryId)) {
      throw new OfferInvalidInputError('invalid category', 'category');
    }
    // Suposição: valor = id da categoria, como em `filters[category].values[].id` da resposta (não capturado)
    filters.push({ id: 'category', value: categoryId });
  }
  return { search, sort, filters, offset: (query.page - 1) * ML_HUB_PAGE_SIZE };
}

export class MercadoLivreHubClient implements IHuntCatalogSource {
  readonly provider = 'MERCADO_LIVRE' as const;

  async listCategories(session: HuntSourceSession): Promise<HuntSourceCategory[]> {
    const json = await this.search(sessionCookies(session), { search: '', sort: 'relevance', filters: [], offset: 0 });
    const cats = parseMercadoLivreHubCategories(json);
    if (!cats) return unavailable({ reason: 'no_filters' }, 'ML hub sem categorias');
    return cats;
  }

  async fetchPage(session: HuntSourceSession, query: HuntSourceQuery): Promise<HuntSourcePage> {
    const cookies = sessionCookies(session);
    const body = buildHubSearchBody(query);
    const json = await this.search(cookies, body);
    const page = parseMercadoLivreHubPage(json, query.category?.categoryId ?? null);
    if (!page) return unavailable({ reason: 'unexpected_page_shape' }, 'ML hub fora do formato');
    if (page.dropped) log.warn({ dropped: page.dropped }, 'ML hub: cartões sem id válido descartados');
    if (page.noCommission) log.warn({ noCommission: page.noCommission }, 'ML hub: cartões sem comissão avaliável descartados');
    return { items: page.items, hasNextPage: page.hasNextPage };
  }

  private async search(cookies: Record<string, string>, body: HubSearchBody): Promise<unknown> {
    // 403 no bootstrap = WAF; só redirect para o login recusa a sessão (indisponível), não sessão recusada (design §3b)
    const { cookies: allCookies } = await bootstrapMercadoLivreSession(cookies, {
      log,
      forbiddenIsRejected: false,
      onlyLoginRedirectIsRejected: true,
    });
    const csrf = allCookies._csrf ?? null;

    const headers: Record<string, string> = {
      'User-Agent': ML_USER_AGENT,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Origin: ML_BASE,
      Referer: ML_HUB_REFERER,
      'X-Requested-With': 'XMLHttpRequest',
      Cookie: buildCookieHeader(allCookies),
    };
    if (csrf) headers['X-Csrf-Token'] = csrf;

    let res: Response;
    try {
      res = await fetch(ML_HUB_SEARCH_URL, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        redirect: 'manual',
        signal: AbortSignal.timeout(ML_TIMEOUT_MS),
      });
    } catch (err) {
      return unavailable({ reason: (err as Error)?.name }, 'ML hub sem resposta');
    }

    if (res.status === 401) {
      await res.body?.cancel().catch(() => undefined);
      log.warn({ status: res.status }, 'ML hub recusou a sessão');
      throw new AffiliateCredentialRejectedError(ML_PROVIDER);
    }
    if (res.status === 429) {
      await res.body?.cancel().catch(() => undefined);
      log.warn({ status: res.status }, 'ML hub rate limit');
      throw new AffiliateApiRateLimitedError(ML_PROVIDER);
    }
    if ((res.status >= 300 && res.status < 400) || res.type === 'opaqueredirect') {
      await res.body?.cancel().catch(() => undefined);
      const location = res.headers.get('location');
      let next: URL | null = null;
      try {
        next = location ? new URL(location, ML_HUB_SEARCH_URL) : null;
      } catch {
        next = null;
      }
      // Só o login recusa a sessão; outro salto (desafio no mesmo host…) = indisponível
      if (next && isMlLoginPage(next)) {
        log.warn({ status: res.status }, 'ML hub redirecionou para login');
        throw new AffiliateCredentialRejectedError(ML_PROVIDER);
      }
      return unavailable({ status: res.status }, 'ML hub redirecionou');
    }
    if (!res.ok) {
      // 403 sem redirect = WAF/anti-bot: fonte indisponível, a sessão segue válida
      await res.body?.cancel().catch(() => undefined);
      return unavailable({ status: res.status }, 'ML hub falhou');
    }

    try {
      return JSON.parse(await readLimited(res)) as unknown;
    } catch (err) {
      return unavailable(
        { status: res.status, reason: err instanceof BodyTooLargeError ? 'too_large' : 'invalid_json' },
        'ML hub resposta ilegível',
      );
    }
  }
}
