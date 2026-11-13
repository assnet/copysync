import { logger } from '../../../../shared/logger/logger';
import {
  AffiliateApiRateLimitedError,
  AffiliateApiUnavailableError,
  AffiliateCredentialRejectedError,
} from '../../../../shared/errors/internal/OfferErrors';
import type {
  IMercadoLivreAffiliateClient,
  MlAccountTags,
  MlAffiliateLinkError,
  MlAffiliateLinkItem,
  MlCreateLinksResult,
} from '../../domain/contracts/IMercadoLivreAffiliateClient';
import {
  LINK_BUILDER_URL,
  ML_BASE,
  ML_PROVIDER,
  ML_TIMEOUT_MS,
  ML_USER_AGENT,
  bootstrapMercadoLivreSession,
  buildCookieHeader,
} from './mercadoLivreBootstrap';

const log = logger.child({ module: 'MlAffiliateClient' });
const TAGS_PATH = '/affiliate-program/api/v2/stripe/user/tags';
const CREATE_LINK_PATH = '/affiliate-program/api/v2/affiliates/createLink';
const TIMEOUT_MS = ML_TIMEOUT_MS;
const PROVIDER = ML_PROVIDER;
const MAX_URLS_PER_BATCH = 20;
const USER_AGENT = ML_USER_AGENT;

const NO_TAGS: MlAccountTags = { tags: null, active: null };

/** Aceita array ou `{ tags: [...] }`; itens sem `tag` string não vazia são ignorados; sem lista → `tags: null`. */
function parseAccountTags(json: unknown): MlAccountTags {
  const list = Array.isArray(json) ? json : (json as Record<string, unknown> | null)?.tags;
  if (!Array.isArray(list)) return NO_TAGS;
  const tags: string[] = [];
  let active: string | null = null;
  let activeSeen = false;
  for (const item of list as unknown[]) {
    const t = item && typeof item === 'object' ? (item as Record<string, unknown>) : null;
    const tag = typeof t?.tag === 'string' ? t.tag.trim() : '';
    // Ativa = primeiro item marcado em uso (mesma regra do antigo getActiveTag), mesmo que sem tag válida
    if (!activeSeen && (t?.in_use === true || t?.inUse === true)) {
      activeSeen = true;
      active = tag || null;
    }
    if (tag && !tags.includes(tag)) tags.push(tag);
  }
  return { tags, active };
}

/** Nunca loga cookie, header, corpo ou segredo: só status/código. */
export class MercadoLivreAffiliateClient implements IMercadoLivreAffiliateClient {
  private bootstrap(sessionCookies: Record<string, string>) {
    return bootstrapMercadoLivreSession(sessionCookies, { log });
  }

  async getActiveTag(cookies: Record<string, string>): Promise<string | null> {
    return (await this.listAccountTags(cookies)).active;
  }

  async listAccountTags(cookies: Record<string, string>): Promise<MlAccountTags> {
    const { cookies: allCookies } = await this.bootstrap(cookies);
    return this.fetchAccountTags(allCookies, allCookies._csrf ?? null);
  }

  async createAffiliateLinks(
    cookies: Record<string, string>,
    urls: string[],
    tag?: string,
  ): Promise<MlCreateLinksResult> {
    if (urls.length === 0) return { success: [], errors: [] };
    const batch = urls.length > MAX_URLS_PER_BATCH ? urls.slice(0, MAX_URLS_PER_BATCH) : urls;

    const { cookies: allCookies } = await this.bootstrap(cookies);
    const csrf = allCookies._csrf ?? null;

    let activeTag = tag;
    if (!activeTag) {
      activeTag = (await this.fetchAccountTags(allCookies, csrf)).active ?? undefined;
    }

    const body = JSON.stringify(activeTag ? { urls: batch, tag: activeTag } : { urls: batch });

    let res: Response;
    try {
      const headers: Record<string, string> = {
        'User-Agent': USER_AGENT,
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Origin: ML_BASE,
        Referer: LINK_BUILDER_URL,
        'X-Requested-With': 'XMLHttpRequest',
        Cookie: buildCookieHeader(allCookies),
      };
      if (csrf) headers['X-Csrf-Token'] = csrf;

      res = await fetch(`${ML_BASE}${CREATE_LINK_PATH}`, {
        method: 'POST',
        headers,
        body,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      log.warn({ reason: (err as Error)?.name }, 'ML createLink sem resposta');
      throw new AffiliateApiUnavailableError(PROVIDER);
    }

    if (res.status === 429) {
      log.warn({ status: 429 }, 'ML createLink rate limit');
      throw new AffiliateApiRateLimitedError(PROVIDER);
    }
    if (res.status === 401 || res.status === 403) {
      throw new AffiliateCredentialRejectedError(PROVIDER);
    }

    let json: Record<string, unknown>;
    try {
      json = (await res.json()) as Record<string, unknown>;
    } catch {
      log.warn({ status: res.status }, 'ML createLink resposta ilegível');
      throw new AffiliateApiUnavailableError(PROVIDER);
    }

    if (!res.ok || !Array.isArray(json.urls)) {
      log.warn({ status: res.status }, 'ML createLink falhou');
      throw new AffiliateApiUnavailableError(PROVIDER);
    }

    const success: MlAffiliateLinkItem[] = [];
    const errors: MlAffiliateLinkError[] = [];

    for (const item of json.urls as Record<string, unknown>[]) {
      if (typeof item.short_url === 'string' && item.short_url) {
        success.push({
          originUrl: String(item.origin_url ?? ''),
          shortUrl: item.short_url,
          longUrl: String(item.long_url ?? ''),
        });
      } else if (item.error_code !== undefined) {
        errors.push({
          originUrl: String(item.origin_url ?? item.url ?? ''),
          errorCode: Number(item.error_code),
          message: String(item.message ?? ''),
        });
      }
    }

    return { success, errors };
  }

  private async fetchAccountTags(
    allCookies: Record<string, string>,
    csrf: string | null,
  ): Promise<MlAccountTags> {
    let res: Response;
    try {
      const headers: Record<string, string> = {
        'User-Agent': USER_AGENT,
        Accept: 'application/json',
        Referer: LINK_BUILDER_URL,
        Cookie: buildCookieHeader(allCookies),
      };
      if (csrf) headers['X-Csrf-Token'] = csrf;

      res = await fetch(`${ML_BASE}${TAGS_PATH}`, {
        method: 'GET',
        headers,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      log.warn({ reason: (err as Error)?.name }, 'ML tags sem resposta');
      return NO_TAGS;
    }

    if (res.status === 429) {
      log.warn({ status: 429 }, 'ML tags rate limit');
      throw new AffiliateApiRateLimitedError(PROVIDER);
    }
    if (res.status === 401 || res.status === 403) {
      throw new AffiliateCredentialRejectedError(PROVIDER);
    }

    let json: unknown;
    try {
      json = await res.json();
    } catch {
      log.warn({ status: res.status }, 'ML tags resposta ilegível');
      return NO_TAGS;
    }
    return parseAccountTags(json);
  }
}
