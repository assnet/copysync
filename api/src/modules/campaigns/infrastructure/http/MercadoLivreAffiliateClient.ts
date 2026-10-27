import { logger } from '../../../../shared/logger/logger';
import {
  AffiliateApiRateLimitedError,
  AffiliateApiUnavailableError,
  AffiliateCredentialRejectedError,
} from '../../../../shared/errors/internal/OfferErrors';
import type {
  IMercadoLivreAffiliateClient,
  MlAffiliateLinkError,
  MlAffiliateLinkItem,
  MlCreateLinksResult,
} from '../../domain/contracts/IMercadoLivreAffiliateClient';

const log = logger.child({ module: 'MlAffiliateClient' });
const ML_BASE = 'https://www.mercadolivre.com.br';
const LINK_BUILDER_PATH = '/affiliate-program/link-builder';
const TAGS_PATH = '/affiliate-program/api/v2/stripe/user/tags';
const CREATE_LINK_PATH = '/affiliate-program/api/v2/affiliates/createLink';
const TIMEOUT_MS = 8_000;
const PROVIDER = 'MERCADO_LIVRE';
const MAX_URLS_PER_BATCH = 20;
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

function safeCookieValue(token: string | null | undefined): string | null {
  return token && /^[A-Za-z0-9._~%+/=-]{1,4096}$/.test(token) ? token : null;
}

function buildCookieHeader(cookies: Record<string, string>): string {
  return Object.entries(cookies)
    .map(([k, v]) => {
      const safe = safeCookieValue(v);
      return safe ? `${k}=${safe}` : null;
    })
    .filter(Boolean)
    .join('; ');
}

function extractSetCookies(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  const raw = headers.getSetCookie?.() ?? [];
  for (const line of raw) {
    const match = /^([^=]+)=([^;]*)/.exec(line);
    if (match) {
      const val = safeCookieValue(match[2]);
      if (val) out[match[1].trim()] = val;
    }
  }
  return out;
}

interface BootstrapResult {
  cookies: Record<string, string>;
}

/** Nunca loga cookie, header, corpo ou segredo: só status/código. */
export class MercadoLivreAffiliateClient implements IMercadoLivreAffiliateClient {
  private async bootstrap(sessionCookies: Record<string, string>): Promise<BootstrapResult> {
    const cookieHeader = buildCookieHeader(sessionCookies);
    if (!cookieHeader) throw new AffiliateCredentialRejectedError(PROVIDER);

    let res: Response;
    try {
      res = await fetch(`${ML_BASE}${LINK_BUILDER_PATH}`, {
        method: 'GET',
        headers: { 'User-Agent': USER_AGENT, Accept: 'text/html', Cookie: cookieHeader },
        redirect: 'manual',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      log.warn({ reason: (err as Error)?.name }, 'ML bootstrap sem resposta');
      throw new AffiliateApiUnavailableError(PROVIDER);
    }

    await res.body?.cancel().catch(() => undefined);

    if (res.status === 401 || res.status === 403) {
      log.warn({ status: res.status }, 'ML bootstrap sessão inválida');
      throw new AffiliateCredentialRejectedError(PROVIDER);
    }

    const setCookies = extractSetCookies(res.headers);
    return { cookies: { ...sessionCookies, ...setCookies } };
  }

  async getActiveTag(cookies: Record<string, string>): Promise<string | null> {
    const { cookies: allCookies } = await this.bootstrap(cookies);
    return this.fetchActiveTag(allCookies, allCookies._csrf ?? null);
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
      activeTag = (await this.fetchActiveTag(allCookies, csrf)) ?? undefined;
    }

    const body = JSON.stringify(activeTag ? { urls: batch, tag: activeTag } : { urls: batch });

    let res: Response;
    try {
      const headers: Record<string, string> = {
        'User-Agent': USER_AGENT,
        Accept: 'application/json',
        'Content-Type': 'application/json',
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

  private async fetchActiveTag(
    allCookies: Record<string, string>,
    csrf: string | null,
  ): Promise<string | null> {
    let res: Response;
    try {
      const headers: Record<string, string> = {
        'User-Agent': USER_AGENT,
        Accept: 'application/json',
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
      return null;
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
      return null;
    }

    const tags = Array.isArray(json) ? json : ((json as Record<string, unknown>)?.tags as unknown);
    if (!Array.isArray(tags)) return null;

    const active = tags.find(
      (t: Record<string, unknown>) => t?.in_use === true || t?.inUse === true,
    );
    return typeof active?.tag === 'string' ? active.tag.trim() || null : null;
  }
}
