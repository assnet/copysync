// Bootstrap da sessão do afiliado ML (spike v1–v7 em docs/extensao-ml-endpoints.md): `GET /afiliados/linkbuilder`
// com o `ssid` colhe `_csrf`/`_d2id` dos Set-Cookie, segue até 3 saltos dentro do hub e trata redirect para o login
// como sessão expirada. Compartilhado por `MercadoLivreAffiliateClient` (createLink/tags) e `MercadoLivreHubClient`.
// Nunca loga cookie, header, corpo ou segredo: só status/código.
import type { Logger } from 'pino';
import {
  AffiliateApiUnavailableError,
  AffiliateCredentialRejectedError,
} from '../../../../shared/errors/internal/OfferErrors';

export const ML_BASE = 'https://www.mercadolivre.com.br';
// Página real do Link Builder. `/affiliate-program/link-builder` responde 404 e não devolve `_csrf`.
export const LINK_BUILDER_PATH = '/afiliados/linkbuilder';
export const LINK_BUILDER_URL = `${ML_BASE}${LINK_BUILDER_PATH}`;
export const ML_TIMEOUT_MS = 8_000;
export const ML_PROVIDER = 'MERCADO_LIVRE';
export const ML_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const BOOTSTRAP_MAX_HOPS = 3;

/** Redirect para fora do hub (login em `mercadolivre.com/jms/...`) = sessão expirada. */
export function isMlLoginRedirect(location: URL): boolean {
  const host = location.hostname.toLowerCase();
  const inHub = (host === 'www.mercadolivre.com.br' || host === 'mercadolivre.com.br') && location.pathname.startsWith('/afiliados/');
  return !inHub;
}

function safeCookieValue(token: string | null | undefined): string | null {
  return token && /^[A-Za-z0-9._~%+/=-]{1,4096}$/.test(token) ? token : null;
}

export function buildCookieHeader(cookies: Record<string, string>): string {
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

export interface MlBootstrapResult {
  /** Cookies da sessão + os colhidos no bootstrap (`_csrf`, `_d2id`…). */
  cookies: Record<string, string>;
}

export interface MlBootstrapOptions {
  log: Pick<Logger, 'warn'>;
  /**
   * 403 no bootstrap = sessão recusada (padrão, comportamento do createLink). O hub passa `false`: 403 sem redirect é
   * WAF e vira fonte indisponível, sem pausar a credencial (design §3b).
   */
  forbiddenIsRejected?: boolean;
}

export async function bootstrapMercadoLivreSession(
  sessionCookies: Record<string, string>,
  { log, forbiddenIsRejected = true }: MlBootstrapOptions,
): Promise<MlBootstrapResult> {
  const cookieHeader = buildCookieHeader(sessionCookies);
  if (!cookieHeader) throw new AffiliateCredentialRejectedError(ML_PROVIDER);

  // Redirect manual: o Set-Cookie (`_csrf`, `_d2id`) de cada salto entra no jar; cair no login = sessão expirada
  const jar: Record<string, string> = { ...sessionCookies };
  let current = new URL(LINK_BUILDER_URL);
  const signal = AbortSignal.timeout(ML_TIMEOUT_MS);
  for (let hop = 0; ; hop++) {
    let res: Response;
    try {
      res = await fetch(current, {
        method: 'GET',
        headers: { 'User-Agent': ML_USER_AGENT, Accept: 'text/html', Cookie: buildCookieHeader(jar) },
        redirect: 'manual',
        signal,
      });
    } catch (err) {
      log.warn({ reason: (err as Error)?.name }, 'ML bootstrap sem resposta');
      throw new AffiliateApiUnavailableError(ML_PROVIDER);
    }
    await res.body?.cancel().catch(() => undefined);
    Object.assign(jar, extractSetCookies(res.headers));

    if (res.status === 401 || (res.status === 403 && forbiddenIsRejected)) {
      log.warn({ status: res.status }, 'ML bootstrap sessão inválida');
      throw new AffiliateCredentialRejectedError(ML_PROVIDER);
    }
    const location = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && location) {
      let next: URL;
      try {
        next = new URL(location, current);
      } catch {
        throw new AffiliateApiUnavailableError(ML_PROVIDER);
      }
      if (isMlLoginRedirect(next)) {
        log.warn({ status: res.status }, 'ML bootstrap redirecionou para login');
        throw new AffiliateCredentialRejectedError(ML_PROVIDER);
      }
      if (hop >= BOOTSTRAP_MAX_HOPS) throw new AffiliateApiUnavailableError(ML_PROVIDER);
      current = next;
      continue;
    }
    if (!res.ok) {
      log.warn({ status: res.status }, 'ML bootstrap falhou');
      throw new AffiliateApiUnavailableError(ML_PROVIDER);
    }
    if (!jar._csrf) log.warn({ status: res.status }, 'ML bootstrap sem _csrf');
    return { cookies: jar };
  }
}
